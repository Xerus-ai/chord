import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * devstation-mg6u.5: an app the sync server turned away (update_required)
 * stops talking to it from main too, not only in the renderer. The minimum
 * exists to guard a server change that breaks older desktops; before this,
 * the sync queue kept pushing, the device socket kept its rooms, the command
 * inbox kept fetching and git-state capture kept polling.
 *
 * Real: SQLite from the shipped migrations, the account signed in through the
 * real path, the four services and the compatibility monitor. The sync server
 * is a local HTTP server answering /health (with a minimum the test sets), the
 * routes those services call, and the WebSocket upgrade of the device socket.
 * One file, run in order: the gate is one per process, as in the app.
 *
 * The bugs these catch: traffic at boot before the first verdict; traffic
 * after an update_required verdict; a socket that reconnects itself after
 * being closed; a verdict mid-drain that still sends the next row or counts
 * the held row as a failure; a resume that skips the reconcile a sign-in
 * during the pause needed.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { syncQueue } = await import('@main/db/schema-sync');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { syncQueueService } = await import('@main/core/work-items/sync-queue-service');
const { gitStateCaptureService } = await import('@main/core/work-items/git-state-capture');
const { commandInboxService } = await import('@main/core/commands/command-inbox-service');
const { deviceSocketService } = await import('@main/core/commands/device-socket-service');
const { DesktopCompatibilityMonitor } = await import('./desktop-compatibility');
const { serverTraffic } = await import('./server-traffic');
const { cloudFetch } = await import('@main/core/work-items/cloud-work-items-client');

const ORG_ID = 'org-traffic';
const X = '66666666-6666-4666-8666-666666666666';
const Y = '77777777-7777-4777-8777-777777777777';
const Z = '88888888-8888-4888-8888-888888888888';
const APP_VERSION = '1.0.0';

let minimum = '0.1.0';
let healthDown = false;
let requests: { method: string | undefined; url: string | undefined }[] = [];
let upgrades = 0;
const openSockets = new Set<Socket>();
/** Set to hold POST /work-items answers until released (the mid-drain case). */
let holdCreates: Promise<void> | null = null;
/** Ids the stand-in holds, listed back as the real server does (creator-scoped GET). */
const cloudIds: string[] = [];
let server: Server;
let base = '';
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

const traffic = () => requests.filter((r) => r.url !== '/health');
const posts = (url: string) => requests.filter((r) => r.method === 'POST' && r.url === url);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Completes the RFC 6455 handshake by hand and answers a close frame, nothing else. */
function acceptUpgrade(req: IncomingMessage, socket: Socket): void {
  upgrades += 1;
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
  socket.on('data', (frame: Buffer) => {
    if ((frame[0]! & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0x00]));
  });
  socket.on('close', () => openSockets.delete(socket));
  socket.on('error', () => openSockets.delete(socket));
}

function startServer(): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        requests.push({ method: req.method, url: req.url });
        const reply = (status: number, body: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.url === '/health') {
          if (healthDown) return reply(503, { error: 'down' });
          return reply(200, { status: 'ok', min_desktop_version: minimum });
        }
        if (req.url === '/auth/sync-profile') return reply(200, { org_id: ORG_ID });
        if (req.url === '/work-items' && req.method === 'GET') {
          return reply(
            200,
            cloudIds.map((id) => ({
              id,
              repo_name: null,
              branch_name: null,
              general_access: 'invited',
            }))
          );
        }
        if (req.url === '/work-items/member-summary') return reply(200, []);
        if (req.url === '/work-items' && req.method === 'POST') {
          if (holdCreates) await holdCreates;
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { id: string };
          cloudIds.push(body.id);
          return reply(201, { id: body.id, version_number: 1 });
        }
        if (req.url === '/commands/fetch') return reply(200, []);
        return reply(200, {});
      })();
    });
  });
  server.on('upgrade', acceptUpgrade);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

/** The real monitor, as the app's service runs it: one completed check. */
async function verdict(min: string): Promise<string> {
  minimum = min;
  const reading = await monitor.check();
  return reading.state;
}

let monitor: InstanceType<typeof DesktopCompatibilityMonitor>;

/** Every way the app reaches the server, as boot, sign-in and timers call them. */
async function knockOnEveryDoor(): Promise<void> {
  await syncQueueService.reconcileLocalWorkItems();
  await syncQueueService.processQueue();
  commandInboxService.kick();
  deviceSocketService.kick();
  gitStateCaptureService.kick();
}

function queueRows() {
  return db.select().from(syncQueue).orderBy(asc(syncQueue.id)).all();
}

beforeAll(async () => {
  base = await startServer();
  process.env.CHORD_CLOUD_API_URL = base;
  monitor = new DesktopCompatibilityMonitor({
    baseUrl: base,
    currentVersion: async () => APP_VERSION,
    onChange: () => {},
  });
  await db.insert(repos).values({ id: 'r-traffic', alias: 'repo', path: '/tmp/traffic' });
  await db.insert(workItems).values([
    { id: X, name: 'X', repoId: 'r-traffic', repoPath: '/tmp/traffic' },
    { id: Y, name: 'Y', repoId: 'r-traffic', repoPath: '/tmp/traffic' },
  ]);
  await signInTestAccount({ username: 'tess', email: 'tess@example.com' });
});

afterAll(async () => {
  deviceSocketService.dispose();
  commandInboxService.dispose();
  syncQueueService.dispose();
  gitStateCaptureService.dispose();
  for (const socket of openSockets) socket.destroy();
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

describe('server traffic follows the version verdict', () => {
  it('sends nothing before the first verdict', async () => {
    // As src/main/index.ts does before it starts the senders.
    serverTraffic.hold();
    await knockOnEveryDoor();
    await sleep(1_500);
    expect(traffic()).toEqual([]);
    expect(upgrades).toBe(0);
  });

  it('a supported verdict opens it: reconcile and drain, inbox fetch, socket connect', async () => {
    expect(await verdict('0.1.0')).toBe('supported');
    await vi.waitFor(
      () => {
        expect(posts('/work-items')).toHaveLength(2);
        expect(posts('/commands/fetch').length).toBeGreaterThan(0);
        expect(openSockets.size).toBe(1);
      },
      { timeout: 10_000, interval: 100 }
    );
    expect(queueRows().filter((r) => r.status === 'pending')).toEqual([]);
  });

  it('an update_required verdict closes the socket and stops every sender', async () => {
    expect(await verdict('2.0.0')).toBe('update_required');
    await vi.waitFor(() => expect(openSockets.size).toBe(0), { timeout: 5_000, interval: 50 });
    const upgradesBefore = upgrades;
    requests = [];

    // Work done while turned away still lands locally.
    syncQueueService.enqueueDelete(X);
    await db
      .insert(workItems)
      .values({ id: Z, name: 'Z', repoId: 'r-traffic', repoPath: '/tmp/traffic' });
    await knockOnEveryDoor();
    // Longer than the socket's first backoff (2 s) and the inbox kick (0.5 s).
    await sleep(3_000);

    expect(traffic()).toEqual([]);
    expect(upgrades).toBe(upgradesBefore);
    expect(
      queueRows()
        .filter((r) => r.status === 'pending')
        .map((r) => r.entityId)
    ).toEqual([X]);
  });

  it('a failed re-check keeps it closed; the next supported verdict resumes everything', async () => {
    healthDown = true;
    expect(await verdict('2.0.0')).toBe('unknown');
    healthDown = false;
    await knockOnEveryDoor();
    await sleep(1_000);
    expect(traffic()).toEqual([]);
    requests = [];

    expect(await verdict('1.0.0')).toBe('supported');
    await vi.waitFor(
      () => {
        // the delete queued while paused, and Z, which only the re-run reconcile finds
        expect(requests.some((r) => r.method === 'DELETE' && r.url?.includes(X))).toBe(true);
        expect(posts('/work-items')).toHaveLength(1);
        expect(posts('/commands/fetch').length).toBeGreaterThan(0);
        expect(openSockets.size).toBe(1);
      },
      { timeout: 10_000, interval: 100 }
    );
    expect(queueRows().filter((r) => r.status === 'pending')).toEqual([]);
  });

  it('a verdict mid-drain sends no further row and spends no retry on the held one', async () => {
    let release!: () => void;
    holdCreates = new Promise<void>((resolve) => {
      release = resolve;
    });
    const A = '99999999-9999-4999-8999-999999999991';
    const B = '99999999-9999-4999-8999-999999999992';
    await db.insert(workItems).values([
      { id: A, name: 'A', repoId: 'r-traffic', repoPath: '/tmp/traffic' },
      { id: B, name: 'B', repoId: 'r-traffic', repoPath: '/tmp/traffic' },
    ]);
    requests = [];
    await syncQueueService.reconcileLocalWorkItems();
    const draining = syncQueueService.processQueue();
    await vi.waitFor(() => expect(posts('/work-items')).toHaveLength(1), {
      timeout: 5_000,
      interval: 20,
    });

    expect(await verdict('2.0.0')).toBe('update_required');
    release();
    holdCreates = null;
    await draining;
    await sleep(1_000);

    expect(posts('/work-items')).toHaveLength(1);
    const held = queueRows().filter((r) => r.status === 'pending');
    expect(held).toHaveLength(1);
    expect(held[0]!.retryCount).toBe(0);
  });

  // Callers the senders' checks do not cover (an agent's publish, an RPC) go
  // through the one fetch helper: it refuses while paused, before any request.
  it('the shared cloud fetch refuses while paused', async () => {
    requests = [];
    await expect(cloudFetch('/organizations/org-traffic/sharing-policy')).rejects.toThrow(/paused/);
    expect(traffic()).toEqual([]);
  });
});
