import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * A work item's chats reach its teammates when it becomes shared, not only on
 * the next change to a chat (devstation-9ld). A teammate's app renders the
 * owner's threads from the cloud's session registry; the owner pushed it only
 * when a chat changed while the item was already shared, so an item shared
 * after its chats existed showed teammates none of them.
 *
 * Real SQLite from the shipped migrations, a real git repo, the account signed
 * in through the real account path; the sync server is a local HTTP server
 * answering the shared-set reads and recording pushes.
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
const { agentSessions, repos, workItems } = await import('@main/db/schema-work-items');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { gitStateCaptureService } = await import('@main/core/work-items/git-state-capture');
const { syncQueueService } = await import('@main/core/work-items/sync-queue-service');
const { startSharedRegistrySync } = await import('@main/core/work-items/shared-registry-sync');

const WORK_ITEM_ID = '66666666-6666-4666-8666-666666666666';
const SESSION_ID = 's-existing-chat';

let hasMembers = false;
const sessionPushes: { sessions: { id: string }[] }[] = [];
let server: Server;
let repo: string;
let stopRegistrySync: () => void;
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

function startSyncServer(): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/auth/sync-profile') return reply(200, { org_id: 'org-share' });
      if (req.url === '/work-items' && req.method === 'GET') {
        return reply(200, [
          {
            id: WORK_ITEM_ID,
            name: 'Shared later',
            repo_name: null,
            repo_remote_url: null,
            branch_name: null,
            general_access: 'invited',
          },
        ]);
      }
      if (req.url === '/work-items/member-summary') {
        return reply(200, [{ work_item_id: WORK_ITEM_ID, has_members: hasMembers }]);
      }
      if (req.url === `/work-items/${WORK_ITEM_ID}/sessions` && req.method === 'PUT') {
        sessionPushes.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        return reply(200, {});
      }
      // Git state and worktree pushes: accepted, not under test here.
      return reply(200, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

beforeAll(async () => {
  await signInTestAccount({ username: 'sharer', email: 'sharer@example.com' });
  process.env.CHORD_CLOUD_API_URL = await startSyncServer();
  repo = mkdtempSync(join(tmpdir(), 'chord-share-registry-'));
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  execSync(
    'git init -q && git add . && git -c user.email=p@example.com -c user.name=p commit -qm init',
    { cwd: repo }
  );
  await db.insert(repos).values({ id: 'r-share', alias: 'repo', path: repo });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    name: 'Shared later',
    repoId: 'r-share',
    repoPath: repo,
    cloudId: WORK_ITEM_ID,
    syncedAt: 1,
  });
  // The chat existed before the item was shared: nothing about it changes below.
  await db.insert(agentSessions).values({
    id: SESSION_ID,
    workItemId: WORK_ITEM_ID,
    kind: 'chat',
    agentProviderId: 'claude',
    title: 'Hi claude',
    status: 'active',
    communication: 'acp',
  });
  stopRegistrySync = startSharedRegistrySync();
});

afterAll(async () => {
  stopRegistrySync();
  gitStateCaptureService.dispose();
  syncQueueService.dispose();
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
  removeDirSync(repo);
});

describe('a work item that becomes shared', () => {
  it('pushes nothing while it is not shared', async () => {
    gitStateCaptureService.kick();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(sessionPushes).toEqual([]);
  });

  it('pushes its existing chats to the cloud within seconds of being shared', async () => {
    hasMembers = true;
    gitStateCaptureService.kick();

    // The registry push is debounced 2 s; the queue must drain it without
    // waiting for its 30 s timer, which alone would take 30 s. The bound means
    // "genuinely stuck": under the parallel suite the debounce, the queue kick
    // and two local round trips took 7-9 s (devstation-7d6), so 6 s failed
    // runs where nothing was wrong, and the late push then landed in the next
    // test's window.
    const pushed = await waitFor(() => sessionPushes.length > 0, 20_000);

    expect(pushed).toBe(true);
    expect(sessionPushes[0].sessions.map((s) => s.id)).toEqual([SESSION_ID]);
  });

  it('does not push again on a later refresh while it stays shared', async () => {
    const before = sessionPushes.length;
    gitStateCaptureService.kick();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(sessionPushes.length).toBe(before);
  });
});
