import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { CHORD_VERSION_HEADER, CHORD_VERSION_PARAM, SemverSchema } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The main process names its version on every request to the sync server
 * (devstation-mg6u.13): the server refuses a request without it, so a call
 * that forgets the header is an app locked out of its own API. Driven against a
 * real local HTTP server that records what main sent: the shared cloud fetch,
 * the sync profile lookup reconcile makes, and the device socket's upgrade.
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

const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { cloudFetch } = await import('@main/core/work-items/cloud-work-items-client');
const { syncQueueService } = await import('@main/core/work-items/sync-queue-service');
const { deviceSocketService } = await import('@main/core/commands/device-socket-service');
const { serverTraffic } = await import('./server-traffic');
const { appService } = await import('./service');

type Seen = { url: string; version: string | undefined };
const requests: Seen[] = [];
const upgrades: string[] = [];
const openSockets = new Set<Socket>();
let server: Server;
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

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

beforeAll(async () => {
  server = createServer((req, res) => {
    const header = req.headers[CHORD_VERSION_HEADER.toLowerCase()];
    requests.push({ url: req.url ?? '', version: Array.isArray(header) ? header[0] : header });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/auth/sync-profile') return res.end(JSON.stringify({ org_id: 'org-v' }));
    if (req.url?.startsWith('/work-items')) return res.end('[]');
    res.end('{}');
  });
  server.on('upgrade', acceptUpgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.CHORD_CLOUD_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await signInTestAccount({ username: 'vera', email: 'vera@example.com' });
  serverTraffic.apply({ state: 'supported', current: '1.0.0', minimum: '0.1.0' });
});

afterAll(async () => {
  deviceSocketService.dispose();
  for (const socket of openSockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env.CHORD_CLOUD_API_URL = originalApiUrl;
});

describe('main names its version to the sync server', () => {
  it('on the shared cloud fetch and on the sync profile lookup', async () => {
    const version = await appService.getCachedAppVersion();
    expect(SemverSchema.safeParse(version).success).toBe(true);

    await cloudFetch('/work-items/member-summary');
    await syncQueueService.reconcileLocalWorkItems();

    const sent = requests.filter((r) => r.url !== '/health');
    expect(sent.map((r) => r.url)).toEqual(
      expect.arrayContaining(['/work-items/member-summary', '/auth/sync-profile'])
    );
    for (const r of sent) expect(r.version, r.url).toBe(version);
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
