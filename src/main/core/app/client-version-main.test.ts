import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { CHORD_VERSION_HEADER, CHORD_VERSION_PARAM, SemverSchema } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The main process names its version on every request to the sync server
 * (devstation-mg6u.13): the server refuses a request without it, so a caller
 * that builds its own request and forgets the header locks that feature out
 * (Team Pulse did, in review round 1). Driven against a real local HTTP server
 * that records what main sent: the shared cloud fetch, the sync profile lookup
 * reconcile makes, the account service's own sync-profile post, Team Pulse's
 * activity read, and the device socket's upgrade.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  // Electron's app as an unpackaged run answers it: no version of its own, so the
  // app's version comes from package.json, as in a dev or e2e build.
  return {
    ...electronWithTestKeychain(),
    app: { getVersion: () => '0.0.0', getAppPath: () => process.cwd() },
  };
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

type Seen = { method: string; url: string; version: string | undefined };
const requests: Seen[] = [];
const upgrades: string[] = [];
const openSockets = new Set<Socket>();

function acceptUpgrade(req: IncomingMessage, socket: Socket): void {
  upgrades.push(req.url ?? '');
  const accept = createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  const protocol = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')[0]
    ?.trim();
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      (protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : '') +
      '\r\n'
  );
  openSockets.add(socket);
  socket.on('close', () => openSockets.delete(socket));
  socket.on('error', () => openSockets.delete(socket));
}

// Started before the account config is imported: it reads the auth server's
// address once, at module load, and the sync server answers sync-profile there.
const server = createServer((req, res) => {
  const header = req.headers[CHORD_VERSION_HEADER.toLowerCase()];
  requests.push({
    method: req.method ?? '',
    url: req.url ?? '',
    version: Array.isArray(header) ? header[0] : header,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url === '/auth/sync-profile') return res.end(JSON.stringify({ org_id: 'org-v' }));
  if (req.url?.startsWith('/work-items') || req.url?.includes('/activity-context')) {
    return res.end('[]');
  }
  res.end('{}');
});
server.on('upgrade', acceptUpgrade);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;
const originalAuthUrl = process.env.CHORD_AUTH_SERVER_URL;
process.env.CHORD_CLOUD_API_URL = BASE;
process.env.CHORD_AUTH_SERVER_URL = BASE;

const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { chordAccountService } = await import('@main/core/account/services/chord-account-service');
const { cloudFetch } = await import('@main/core/work-items/cloud-work-items-client');
const { syncQueueService } = await import('@main/core/work-items/sync-queue-service');
const { deviceSocketService } = await import('@main/core/commands/device-socket-service');
const { encryptedAppSecretsStore } = await import('@main/core/secrets/encrypted-app-secrets-store');
const { generateTeamPulse } = await import('@main/core/openrouter/team-pulse-generator');
const { serverTraffic } = await import('./server-traffic');
const { appService } = await import('./service');

beforeAll(async () => {
  await signInTestAccount({ username: 'vera', email: 'vera@example.com' });
  serverTraffic.apply({ state: 'supported', current: '1.0.0', minimum: '0.1.0' });
});

afterAll(async () => {
  deviceSocketService.dispose();
  for (const socket of openSockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  process.env.CHORD_AUTH_SERVER_URL = originalAuthUrl;
});

/** The requests to `path` since `from`, each with the version it named. */
const sentTo = (path: string, from: number) =>
  requests.slice(from).filter((r) => r.url.startsWith(path));

describe('main names its version to the sync server', () => {
  it('on the shared cloud fetch and on the sync profile lookup', async () => {
    const version = await appService.getCachedAppVersion();
    expect(SemverSchema.safeParse(version).success).toBe(true);
    const from = requests.length;

    await cloudFetch('/work-items/member-summary');
    await syncQueueService.reconcileLocalWorkItems();

    const sent = requests.slice(from).filter((r) => r.url !== '/health');
    expect(sent.map((r) => r.url)).toEqual(
      expect.arrayContaining(['/work-items/member-summary', '/auth/sync-profile'])
    );
    for (const r of sent) expect(r.version, r.url).toBe(version);
  });

  it("on the account service's own sync-profile post (choosing an org)", async () => {
    const version = await appService.getCachedAppVersion();
    const from = requests.length;
    await chordAccountService.setActiveOrg('org-v');
    const posts = sentTo('/auth/sync-profile', from).filter((r) => r.method === 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0]!.version).toBe(version);
  });

  it("on the account service's session check", async () => {
    const version = await appService.getCachedAppVersion();
    await chordAccountService.loadSessionToken();
    const from = requests.length;
    await chordAccountService.validateSession();
    const checks = sentTo('/api/auth/get-session', from);
    expect(checks.length).toBe(1);
    expect(checks[0]!.version).toBe(version);
  });

  // Team Pulse's two sync-server requests (the activity read and the summaries
  // post) go through one request function, so this read covers the header both
  // send; the post itself needs a live model completion to be reached.
  it("on Team Pulse generation's read of the team's activity", async () => {
    const version = await appService.getCachedAppVersion();
    await encryptedAppSecretsStore.setSecret('chord-openrouter-api-key', 'test-key');
    const from = requests.length;
    const result = await generateTeamPulse('org-v', BASE);
    expect(result).toEqual({ success: true, count: 0 });
    const reads = sentTo('/team-pulse/org-v/activity-context', from);
    expect(reads.length).toBe(1);
    expect(reads[0]!.version).toBe(version);
  });

  it('on the device socket upgrade, as a query parameter', async () => {
    const version = await appService.getCachedAppVersion();
    deviceSocketService.initialize();
    deviceSocketService.kick();
    await vi.waitFor(() => expect(upgrades.length).toBeGreaterThan(0), { timeout: 10_000 });
    const url = new URL(upgrades[0]!, 'http://local');
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get(CHORD_VERSION_PARAM)).toBe(version);
  });
});
