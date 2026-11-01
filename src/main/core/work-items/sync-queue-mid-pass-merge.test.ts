import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CloudChatBulkMessage } from '@chord/protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A payload merged into a queue row after the drain pass selected it, while
 * an earlier row of the same pass is still being sent (devstation-83y). The
 * row is sent and deleted once, so what it sends must include that merge:
 *
 * - a permission request answered while its create waits behind another send
 *   reaches the cloud as resolved (seen 2026-09-29: six answered requests
 *   stayed "pending" for teammates, with live Allow buttons);
 * - a chat message appended to a queued bulk row reaches the cloud.
 *
 * Real SQLite from the shipped migrations; the account is signed in through
 * the real account path; the sync server is a local HTTP server. It makes the
 * merge land mid-pass deterministically: the first send's handler enqueues it
 * before answering.
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

const WORK_ITEM_ID = '55555555-5555-4555-8555-555555555555';
const FIRST = 'req-first';
const SECOND = 'req-second';

let received: { url: string; body: Record<string, unknown> }[] = [];
/** Runs inside the first send's handler, before it answers. */
let duringFirstSend: (() => void) | null = null;
let server: Server;
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
      if (req.url === '/auth/sync-profile') return reply(200, { org_id: 'org-mid-pass' });
      received.push({
        url: req.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>,
      });
      const hook = duringFirstSend;
      duringFirstSend = null;
      hook?.();
      return reply(200, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function publish(requestId: string): void {
  syncQueueService.enqueuePermissionRequestCreate(requestId, {
    work_item_id: WORK_ITEM_ID,
    session_id: 's-1',
    tool_name: 'Write',
    input: { file_path: 'notes.md' },
    options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }],
    status: 'pending',
  });
}

function chatMessage(id: string): CloudChatBulkMessage {
  return { id, content: id } as unknown as CloudChatBulkMessage;
}

/** Drains until the queue is empty, as the timer would; bounded. */
async function drain(): Promise<void> {
  for (let i = 0; i < 5 && db.select().from(syncQueue).all().length > 0; i++) {
    db.update(syncQueue).set({ lastAttemptedAt: null }).run();
    await syncQueueService.processQueue();
  }
}

beforeAll(async () => {
  await signInTestAccount({ username: 'midpass', email: 'midpass@example.com' });
  process.env.CHORD_CLOUD_API_URL = await startSyncServer();
  await db.insert(repos).values({ id: 'r-mid', alias: 'repo', path: '/tmp/mid' });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    name: 'Mid pass',
    repoId: 'r-mid',
    repoPath: '/tmp/mid',
    cloudId: WORK_ITEM_ID,
    syncedAt: 1,
  });
});

beforeEach(() => {
  received = [];
  duringFirstSend = null;
  db.delete(syncQueue).run();
});

afterEach(() => {
  // enqueue* kicks a timed drain; every test drains explicitly instead.
  syncQueueService.dispose();
});

afterAll(async () => {
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

describe('a merge into a row the pass already selected', () => {
  it('reaches the cloud: a request answered while its create waits arrives resolved', async () => {
    publish(FIRST);
    publish(SECOND);
    duringFirstSend = () =>
      syncQueueService.enqueuePermissionRequestUpdate(SECOND, {
        work_item_id: WORK_ITEM_ID,
        status: 'resolved',
        resolution: 'allow_once',
        resolved_by: null,
      });

    await drain();

    const second = received.filter((r) => r.url.endsWith(`/permission-requests/${SECOND}`));
    expect(second.length).toBeGreaterThan(0);
    expect(second.at(-1)?.body).toMatchObject({ status: 'resolved', resolution: 'allow_once' });
    expect(db.select().from(syncQueue).all()).toEqual([]);
  });

  it('reaches the cloud: a chat message appended to a queued bulk row is sent', async () => {
    publish(FIRST);
    syncQueueService.enqueueChatMessages(WORK_ITEM_ID, [chatMessage('m-1')]);
    duringFirstSend = () =>
      syncQueueService.enqueueChatMessages(WORK_ITEM_ID, [chatMessage('m-2')]);

    await drain();

    const sentIds = received
      .filter((r) => r.url === `/work-items/${WORK_ITEM_ID}/messages/bulk`)
      .flatMap((r) => (r.body.messages as { id: string }[]).map((m) => m.id));
    expect(new Set(sentIds)).toEqual(new Set(['m-1', 'm-2']));
    expect(db.select().from(syncQueue).all()).toEqual([]);
  });
});
