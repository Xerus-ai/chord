import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * An app the sync server turned away (update_required) stops talking to it
 * from main too, not only in the renderer: the minimum exists to guard a
 * server change that breaks older desktops.
 *
 * Real: SQLite from the shipped migrations, the account signed in through the
 * real path, the senders started as boot starts them (startServerSenders) and
 * the compatibility monitor driving the gate as the app's service does. The
 * sync server is a local HTTP server answering /health (with a minimum the
 * test sets), the routes those services call, and the WebSocket upgrade of the
 * device socket. Each case uses its own work items and sets the verdict it
 * starts from, so it passes run alone (-t) as well as in the file.
 *
 * The bugs these catch: traffic at boot before the first verdict (boot not
 * holding the gate); traffic after an update_required verdict; a socket that
 * reconnects itself after being closed; a verdict mid-drain, or between a
 * row's claim and its send, that still sends or spends a retry; a resume that
 * skips the reconcile a sign-in during the pause needed; a stopped sender that
 * still wakes when traffic reopens; boot's first opening taken for a resume
 * (which would hide a stalled sync for 15 minutes after every launch).
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
const { commandInboxService } = await import('@main/core/commands/command-inbox-service');
const { deviceSocketService } = await import('@main/core/commands/device-socket-service');
const { gitStateCaptureService } = await import('@main/core/work-items/git-state-capture');
const { processSyncRow } = await import('@main/core/work-items/sync-queue-process-row');
const { sendSyncOperation } = await import('@main/core/work-items/sync-queue-send');
const { insertWorkItemDeleteRow } = await import('@main/core/work-items/sync-queue-writes');
const { syncQueueHealth } = await import('@main/core/work-items/sync-queue-health');
const { DesktopCompatibilityMonitor } = await import('./desktop-compatibility');
const { serverTraffic } = await import('./server-traffic');
const { startServerSenders, stopServerSenders } = await import('./start-server-senders');
const { cloudFetch } = await import('@main/core/work-items/cloud-work-items-client');

const ORG_ID = 'org-traffic';
const APP_VERSION = '1.0.0';

type Request = { method: string | undefined; url: string | undefined; id?: string };

let minimum = '0.1.0';
let healthDown = false;
let requests: Request[] = [];
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
const fetches = () => requests.filter((r) => r.method === 'POST' && r.url === '/commands/fetch');
/** Creates the stand-in received for these work items. */
const created = (...ids: string[]) =>
  requests.filter((r) => r.method === 'POST' && r.url === '/work-items' && ids.includes(r.id!));
const deleted = (id: string) =>
  requests.some((r) => r.method === 'DELETE' && r.url === `/work-items/${id}`);
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
        const request: Request = { method: req.method, url: req.url };
        requests.push(request);
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
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { id: string };
          request.id = body.id;
          if (holdCreates) await holdCreates;
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

let monitor: InstanceType<typeof DesktopCompatibilityMonitor>;

/** The real monitor, as the app's service runs it: one completed check. */
async function verdict(min: string): Promise<string> {
  minimum = min;
  const reading = await monitor.check();
  return reading.state;
}

/** Every way the app reaches the server, as boot, sign-in and timers call them. */
async function knockOnEveryDoor(): Promise<void> {
  await syncQueueService.reconcileLocalWorkItems();
  await syncQueueService.processQueue();
  commandInboxService.kick();
  deviceSocketService.kick();
  gitStateCaptureService.kick();
}

/** Pending queue rows for these entities, oldest first. */
function pending(...ids: string[]) {
  return db
    .select()
    .from(syncQueue)
    .orderBy(asc(syncQueue.id))
    .all()
    .filter((r) => r.status === 'pending' && ids.includes(r.entityId));
}

async function insertItems(...ids: string[]): Promise<void> {
  await db
    .insert(workItems)
    .values(ids.map((id) => ({ id, name: id, repoId: 'r-traffic', repoPath: '/tmp/traffic' })));
}

beforeAll(async () => {
  base = await startServer();
  process.env.CHORD_CLOUD_API_URL = base;
  monitor = new DesktopCompatibilityMonitor({
    baseUrl: base,
    currentVersion: async () => APP_VERSION,
    onChange: () => {},
    onVerdict: (state) => serverTraffic.apply(state),
    intervals: { regular: 60_000, paused: 60_000 },
    // each test is one launch: nothing is remembered from an earlier one
    memory: { load: async () => null, save: async () => {} },
  });
  await db.insert(repos).values({ id: 'r-traffic', alias: 'repo', path: '/tmp/traffic' });
  await signInTestAccount({ username: 'tess', email: 'tess@example.com' });
});

afterAll(async () => {
  stopServerSenders();
  for (const socket of openSockets) socket.destroy();
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

describe('server traffic follows the version verdict', () => {
  it('boot holds every sender until a verdict; update_required stops them, supported resumes them', async () => {
    const X = '66666666-6666-4666-8666-666666666666';
    const Y = '77777777-7777-4777-8777-777777777777';
    const Z = '88888888-8888-4888-8888-888888888888';
    await insertItems(X, Y);

    // Boot: the senders start with the gate held, before any verdict.
    startServerSenders();
    requests = [];
    await knockOnEveryDoor();
    await sleep(1_500);
    expect(traffic()).toEqual([]);
    expect(upgrades).toBe(0);

    // Supported: reconcile and drain, inbox fetch, socket connect.
    expect(await verdict('0.1.0')).toBe('supported');
    await vi.waitFor(
      () => {
        expect(created(X, Y)).toHaveLength(2);
        expect(fetches().length).toBeGreaterThan(0);
        expect(openSockets.size).toBe(1);
      },
      { timeout: 10_000, interval: 100 }
    );
    expect(pending(X, Y)).toEqual([]);
    // Boot's first opening is not a resume from a pause.
    expect((await syncQueueHealth.getHealth()).resumedAt).toBeNull();

    // update_required: the socket closes and every sender stops.
    expect(await verdict('2.0.0')).toBe('update_required');
    await vi.waitFor(() => expect(openSockets.size).toBe(0), { timeout: 5_000, interval: 50 });
    const upgradesBefore = upgrades;
    requests = [];
    // Work done while turned away still lands locally.
    syncQueueService.enqueueDelete(X);
    await insertItems(Z);
    await knockOnEveryDoor();
    // Longer than the socket's first backoff (2 s) and the inbox kick (0.5 s).
    await sleep(3_000);
    expect(traffic()).toEqual([]);
    expect(upgrades).toBe(upgradesBefore);
    expect(pending(X, Z).map((r) => r.entityId)).toEqual([X]);

    // A failed re-check keeps it closed.
    healthDown = true;
    expect(await verdict('2.0.0')).toBe('unknown');
    healthDown = false;
    await knockOnEveryDoor();
    await sleep(1_000);
    expect(traffic()).toEqual([]);

    // The next supported verdict resumes everything: the delete queued while
    // paused, and Z, which only the owed reconcile finds.
    requests = [];
    expect(await verdict('1.0.0')).toBe('supported');
    await vi.waitFor(
      () => {
        expect(deleted(X)).toBe(true);
        expect(created(Z)).toHaveLength(1);
        expect(fetches().length).toBeGreaterThan(0);
        expect(openSockets.size).toBe(1);
      },
      { timeout: 10_000, interval: 100 }
    );
    expect(pending(X, Z)).toEqual([]);
    // Reopening after the pause restarts the sync badge's staleness clock.
    expect((await syncQueueHealth.getHealth()).resumedAt).not.toBeNull();
  });

  it('a verdict mid-drain sends no further row and spends no retry on the held one', async () => {
    const A = '99999999-9999-4999-8999-999999999991';
    const B = '99999999-9999-4999-8999-999999999992';
    expect(await verdict('0.1.0')).toBe('supported');
    let release!: () => void;
    holdCreates = new Promise<void>((resolve) => {
      release = resolve;
    });
    await insertItems(A, B);
    requests = [];
    await syncQueueService.reconcileLocalWorkItems();
    const draining = syncQueueService.processQueue();
    await vi.waitFor(() => expect(created(A, B)).toHaveLength(1), {
      timeout: 5_000,
      interval: 20,
    });

    expect(await verdict('2.0.0')).toBe('update_required');
    release();
    holdCreates = null;
    await draining;
    await sleep(1_000);

    expect(created(A, B)).toHaveLength(1);
    const held = pending(A, B);
    expect(held).toHaveLength(1);
    expect(held[0]!.retryCount).toBe(0);
  });

  it('a verdict between a row claim and its send leaves the row pending, retry unspent', async () => {
    const W = '99999999-9999-4999-8999-999999999993';
    expect(await verdict('0.1.0')).toBe('supported');
    requests = [];
    // Inserted and claimed with no await between: no other cycle can take it.
    insertWorkItemDeleteRow(W);
    const [row] = pending(W);
    const outcome = await processSyncRow(row!, async (claimed) => {
      expect(await verdict('2.0.0')).toBe('update_required');
      return sendSyncOperation(claimed, ORG_ID, () => {});
    });

    expect(outcome).toEqual({ proceed: false, delivered: false });
    expect(deleted(W)).toBe(false);
    expect(pending(W)).toMatchObject([{ retryCount: 0, errorMessage: null }]);
  });

  // Callers the senders' checks do not cover (an agent's publish, an RPC) go
  // through the one fetch helper: it refuses while paused, before any request.
  it('the shared cloud fetch refuses while paused', async () => {
    expect(await verdict('2.0.0')).toBe('update_required');
    requests = [];
    await expect(cloudFetch('/organizations/org-traffic/sharing-policy')).rejects.toThrow(/paused/);
    expect(traffic()).toEqual([]);
  });

  it('a stopped sender stays stopped when traffic reopens', async () => {
    const V = '99999999-9999-4999-8999-999999999994';
    // The inbox fetches only for the work items this machine holds.
    await insertItems(V);
    stopServerSenders();
    const upgradesAtRestart = upgrades;
    startServerSenders();
    expect(await verdict('0.1.0')).toBe('supported');
    // The restarted device socket is live, so its stop below is what keeps it down.
    await vi.waitFor(() => expect(upgrades).toBeGreaterThan(upgradesAtRestart), {
      timeout: 5_000,
      interval: 50,
    });
    requests = [];
    commandInboxService.kick();
    await vi.waitFor(() => expect(fetches().length).toBeGreaterThan(0), {
      timeout: 5_000,
      interval: 50,
    });
    // Rows earlier cases left are drained first: a drain cycle still in flight
    // when the senders stop would legitimately send V once traffic reopens.
    await vi.waitFor(
      () =>
        expect(
          db
            .select()
            .from(syncQueue)
            .all()
            .filter((r) => r.status !== 'failed')
        ).toEqual([]),
      { timeout: 10_000, interval: 50 }
    );
    await sleep(1_000);
    expect(await verdict('2.0.0')).toBe('update_required');
    stopServerSenders();
    // Queued without a kick: only a resume that still reaches the stopped
    // sync queue would send it.
    insertWorkItemDeleteRow(V);
    const upgradesBefore = upgrades;
    requests = [];

    expect(await verdict('0.1.0')).toBe('supported');
    await sleep(1_500);
    expect(fetches()).toEqual([]);
    expect(deleted(V)).toBe(false);
    expect(upgrades).toBe(upgradesBefore);
  });

  // A stopped sender's own guards hide a kept listener from the network; count it instead.
  it('a stop releases every traffic listener its start took', () => {
    stopServerSenders();
    const before = serverTraffic.subscriberCount;
    startServerSenders();
    expect(serverTraffic.subscriberCount).toBeGreaterThan(before);
    stopServerSenders();
    expect(serverTraffic.subscriberCount).toBe(before);
  });
});
