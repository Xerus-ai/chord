import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The owner's app tells the cloud which repo a work item lives in by its
 * normalized origin (shared-items step 3, H7, decision 5): on the create, and,
 * for items the cloud already has, through the startup reconcile's backfill
 * patch, beside the repo name it already backfills. A teammate's sidebar
 * matches on it.
 *
 * Real SQLite from the shipped migrations, a real git repository with a real
 * origin, the real account path; the sync server is a local HTTP server that
 * records what it is sent.
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
const { syncQueueService } = await import('./sync-queue-service');

const execFileAsync = promisify(execFile);

const ORG_ID = 'org-remote';
const ITEM = '66666666-6666-4666-8666-666666666666';
const REMOTE = 'github.com/acme/chord';

interface CloudRow {
  id: string;
  repo_name: string | null;
  branch_name: string | null;
  repo_remote_url: string | null;
  general_access: 'invited';
}

let cloudListing: CloudRow[] = [];
let sent: { method: string | undefined; url: string | undefined; body: unknown }[] = [];
let server: Server;
let repoDir = '';
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

function startSyncServer(): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      sent.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/auth/sync-profile') return reply(200, { org_id: ORG_ID });
      if (req.url === '/work-items' && req.method === 'GET') return reply(200, cloudListing);
      if (req.url === '/work-items' && req.method === 'POST') {
        return reply(201, { id: (JSON.parse(raw) as { id: string }).id, version_number: 1 });
      }
      if (req.method === 'PATCH') return reply(200, { version_number: 2 });
      return reply(201, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function sentTo(method: string, url: string): unknown[] {
  return sent.filter((r) => r.method === method && r.url === url).map((r) => r.body);
}

async function reconcileAndDrain(): Promise<void> {
  await syncQueueService.reconcileLocalWorkItems();
  await syncQueueService.processQueue();
}

beforeAll(async () => {
  process.env.CHORD_CLOUD_API_URL = await startSyncServer();
  repoDir = await mkdtemp(join(tmpdir(), 'chord-sync-remote-'));
  await execFileAsync('git', ['init', repoDir]);
  await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:Acme/Chord.git'], {
    cwd: repoDir,
  });
  await db.insert(repos).values({ id: 'r-chord', alias: 'chord', path: repoDir });
});

beforeEach(async () => {
  sent = [];
  cloudListing = [];
  db.delete(syncQueue).run();
  db.delete(workItems).run();
  await db.insert(workItems).values({
    id: ITEM,
    name: 'Item',
    repoId: 'r-chord',
    repoAlias: 'chord',
    repoPath: repoDir,
    branchName: 'chord/item',
  });
  await signInTestAccount({ username: 'alice', email: 'alice@example.com' });
});

afterEach(() => {
  syncQueueService.dispose();
});

afterAll(async () => {
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
  await rm(repoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('the repo remote on the cloud work item', () => {
  it('rides on the create of an item the cloud does not have yet', async () => {
    await reconcileAndDrain();

    expect(sentTo('POST', '/work-items')).toEqual([
      expect.objectContaining({ id: ITEM, repo_name: 'chord', repo_remote_url: REMOTE }),
    ]);
  });

  it('is backfilled onto a cloud item created before it existed', async () => {
    cloudListing = [
      {
        id: ITEM,
        repo_name: 'chord',
        branch_name: 'chord/item',
        repo_remote_url: null,
        general_access: 'invited',
      },
    ];

    await reconcileAndDrain();

    expect(sentTo('PATCH', `/work-items/${ITEM}`)).toEqual([
      expect.objectContaining({ repo_remote_url: REMOTE }),
    ]);
  });

  it('sends nothing when the cloud already has it', async () => {
    cloudListing = [
      {
        id: ITEM,
        repo_name: 'chord',
        branch_name: 'chord/item',
        repo_remote_url: REMOTE,
        general_access: 'invited',
      },
    ];

    await reconcileAndDrain();

    expect(sent.filter((r) => r.method === 'PATCH')).toEqual([]);
  });
});
