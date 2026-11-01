import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sync acts only for the signed-in account's own work items (devstation-as2).
 * Local data outlives sign-out, so one profile can hold items of several
 * accounts. The field case: a profile created and synced 13 items under one
 * account, signed out, signed in as another; before `work_items.owner_
 * account_id` the new account's reconcile re-sent every one of them as a
 * create, got 409 (different creator) five times per launch, and would have
 * uploaded any never-synced item of the first account under the second.
 *
 * Real SQLite from the shipped migrations; the accounts sign in through the
 * real account path; the sync server is a local HTTP server answering what
 * routes/work-items.ts does. Account switch = signInTestAccount with another
 * user, exactly what sign-out + sign-in leaves in the profile row.
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
const { chatMessages, repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts } = await import('@main/db/schema-artifacts');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { chordAccountService } = await import('@main/core/account/services/chord-account-service');
const { syncQueueService } = await import('./sync-queue-service');
const { syncQueueHealth } = await import('./sync-queue-health');
const { OWNED_BY_ANOTHER_ACCOUNT } = await import('@shared/work-item-ownership');

const ORG_ID = 'org-ownership';
const A = { username: 'alice', email: 'alice@example.com' };
const B = { username: 'bob', email: 'bob@example.com' };
const A_ID = 'user-alice';
const B_ID = 'user-bob';
const X = '44444444-4444-4444-8444-444444444444';
const Y = '55555555-5555-4555-8555-555555555555';

let cloudListing: string[] = [];
let takenIds: string[] = [];
let requests: { method: string | undefined; url: string | undefined }[] = [];
let server: Server;
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

function startSyncServer(): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url });
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/auth/sync-profile') return reply(200, { org_id: ORG_ID });
      if (req.url === '/work-items' && req.method === 'GET') {
        return reply(
          200,
          cloudListing.map((id) => ({
            id,
            repo_name: null,
            branch_name: null,
            general_access: 'invited',
          }))
        );
      }
      if (req.url === '/work-items' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { id: string };
        if (takenIds.includes(body.id)) {
          return reply(409, { error: 'Work item id already exists' });
        }
        // Created under the caller: the creator-scoped listing has it from now on.
        cloudListing.push(body.id);
        return reply(201, { id: body.id, version_number: 1 });
      }
      // access-middleware.ts: a caller with no access to the item gets 404.
      if (takenIds.some((id) => req.url?.startsWith(`/work-items/${id}/`))) {
        return reply(404, { error: 'Work item not found' });
      }
      return reply(201, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function queueRows() {
  return db.select().from(syncQueue).orderBy(asc(syncQueue.id)).all();
}

function workItem(id: string) {
  return db.select().from(workItems).where(eq(workItems.id, id)).get();
}

function requestsNaming(id: string) {
  return requests.filter((r) => r.url?.includes(id));
}

async function reconcileAndDrain(): Promise<void> {
  await syncQueueService.reconcileLocalWorkItems();
  await syncQueueService.reconcileLocalArtifacts();
  await syncQueueService.reconcileLocalChatMessages();
  await syncQueueService.processQueue();
}

beforeAll(async () => {
  process.env.CHORD_CLOUD_API_URL = await startSyncServer();
  await db.insert(repos).values({ id: 'r-own', alias: 'repo', path: '/tmp/own' });
});

beforeEach(async () => {
  requests = [];
  cloudListing = [];
  takenIds = [];
  db.delete(syncQueue).run();
  db.delete(chatMessages).run();
  db.delete(artifacts).run();
  db.delete(workItems).run();
  // Two rows from before the column existed: unattributed, never synced.
  await db.insert(workItems).values([
    { id: X, name: 'X', repoId: 'r-own', repoPath: '/tmp/own' },
    { id: Y, name: 'Y', repoId: 'r-own', repoPath: '/tmp/own' },
  ]);
  await db.insert(artifacts).values({
    id: 'a-x',
    workItemId: X,
    filePath: '/tmp/own/plan.md',
    name: 'plan.md',
    type: 'markdown',
    contentType: 'markdown',
  });
  await signInTestAccount(A);
});

afterEach(() => {
  syncQueueService.dispose();
});

afterAll(async () => {
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

describe('a row from before owner_account_id existed', () => {
  it('is attributed to the account that reconciles it, and its create is delivered under that account', async () => {
    await reconcileAndDrain();

    expect(workItem(X)).toMatchObject({ ownerAccountId: A_ID, cloudId: X });
    expect(workItem(Y)).toMatchObject({ ownerAccountId: A_ID, cloudId: Y });
    expect(queueRows().filter((r) => r.entityType === 'work_item')).toEqual([]);
  });

  it("whose id the server holds under another creator is marked as another account's — not failed, not retried", async () => {
    takenIds = [Y];
    // Child activity queued for Y before the answer came back.
    syncQueueService.enqueueChatMessages(Y, [
      { id: 'm-y', role: 'user', content: 'hi', created_at: 1_790_000_000 },
    ] as never);

    await reconcileAndDrain();

    expect(workItem(Y)).toMatchObject({ ownerAccountId: OWNED_BY_ANOTHER_ACCOUNT, cloudId: null });
    expect(queueRows().filter((r) => r.entityId === Y)).toEqual([]);
    expect(syncQueueService.getFailedOperations()).toEqual([]);
    expect((await syncQueueHealth.getHealth()).pendingCount).toBe(0);

    // The next startup: nothing is sent for Y again.
    requests = [];
    await reconcileAndDrain();
    expect(requestsNaming(Y)).toEqual([]);
    expect(requests.filter((r) => r.method === 'POST' && r.url === '/work-items')).toEqual([]);
  });
});

describe('the first launch after upgrading from a build that failed 409 creates', () => {
  const HOURS_AGO_15 = Math.floor(Date.now() / 1000) - 15 * 60 * 60;
  const CONFLICT = 'HTTP 409: {"error":"Work item id already exists"}';

  function insertRow(row: Partial<typeof syncQueue.$inferInsert>) {
    db.insert(syncQueue)
      .values({ operation: 'create', payload: '{}', ...row } as typeof syncQueue.$inferInsert)
      .run();
  }

  // The seed profile's shape (chord-p1-smoke): children queued while the item
  // was live, their orphan clock started on an earlier launch; one child the
  // old build failed outright; then one failed create per launch.
  beforeEach(() => {
    takenIds = [Y];
    insertRow({
      entityType: 'chat_message_bulk',
      operation: 'update',
      entityId: Y,
      payload: JSON.stringify({ messages: [] }),
      firstOrphanedAt: HOURS_AGO_15,
      lastAttemptedAt: HOURS_AGO_15,
    });
    insertRow({
      entityType: 'artifact',
      entityId: 'a-y',
      payload: JSON.stringify({
        work_item_id: Y,
        name: 'notes.md',
        content_type: 'markdown',
        render_class: 'document',
      }),
      firstOrphanedAt: HOURS_AGO_15,
      lastAttemptedAt: HOURS_AGO_15,
    });
    insertRow({
      entityType: 'artifact',
      entityId: 'a-y-viewer',
      payload: JSON.stringify({
        work_item_id: Y,
        name: 'spec.md',
        content_type: 'markdown',
        render_class: 'document',
      }),
      status: 'failed',
      retryCount: 5,
      lastAttemptedAt: HOURS_AGO_15,
      errorMessage: 'HTTP 403: {"error":"Viewers have read-only access"}',
    });
    for (let launch = 0; launch < 2; launch++) {
      insertRow({
        entityType: 'work_item',
        entityId: Y,
        payload: JSON.stringify({ name: 'Y', status: 'active' }),
        status: 'failed',
        retryCount: 5,
        lastAttemptedAt: HOURS_AGO_15,
        errorMessage: CONFLICT,
      });
    }
  });

  it('never reports a failure: the stale verdicts are re-judged and the children wait for their parent', async () => {
    syncQueueService.initialize();
    expect(syncQueueService.getFailedOperations()).toEqual([]);

    await vi.waitFor(() => expect(queueRows()).toEqual([]));
    expect(syncQueueService.getFailedOperations()).toEqual([]);
    expect(workItem(Y)).toMatchObject({ ownerAccountId: OWNED_BY_ANOTHER_ACCOUNT });
    // The children were never sent: the parent settled first and took them with it.
    expect(requests.filter((r) => r.url?.startsWith(`/work-items/${Y}/`))).toEqual([]);

    // The reconcile that follows sign-in sends nothing more for Y.
    await reconcileAndDrain();
    expect(requestsNaming(Y)).toEqual([]);
    expect(syncQueueService.getFailedOperations()).toEqual([]);
  });

  it('leaves a create that failed for another reason failed, with its failed child', async () => {
    db.update(syncQueue)
      .set({ errorMessage: 'HTTP 400: {"error":"name is required"}' })
      .where(eq(syncQueue.entityType, 'work_item'))
      .run();
    syncQueueService.initialize();
    const failed = syncQueueService.getFailedOperations();
    expect(failed.map((r) => r.entityId).sort()).toEqual([Y, 'a-y-viewer'].sort());

    // Let this launch's drain finish before the next test reuses the service.
    await vi.waitFor(() => expect(queueRows().every((r) => r.status === 'failed')).toBe(true));
  });
});

describe('after switching accounts', () => {
  beforeEach(async () => {
    await reconcileAndDrain(); // X and Y are alice's, synced
    // Bob's listing is his own: alice's items are not in it.
    cloudListing = [];
    await signInTestAccount(B);
    // What the sign-in path does: the session is read as soon as it changes,
    // which is what the synchronous enqueue gate reads its user from.
    await chordAccountService.getSession();
    requests = [];
  });

  it("reconciles, enqueues and drains nothing of the previous account's", async () => {
    syncQueueService.enqueueUpdate(X, { name: 'renamed by bob?' });
    syncQueueService.enqueueChatMessages(X, [
      { id: 'm-x', role: 'user', content: 'hi', created_at: 1_790_000_000 },
    ] as never);
    syncQueueService.enqueueArtifactCreate('a-x', {
      work_item_id: X,
      name: 'plan.md',
      content_type: 'markdown',
      render_class: 'document',
      status: 'draft',
    });
    syncQueueService.enqueueDelete(Y);
    expect(queueRows()).toEqual([]);

    // A row that was already queued when the account changed.
    db.insert(syncQueue)
      .values({
        entityType: 'git_state',
        operation: 'update',
        entityId: X,
        payload: JSON.stringify({ branch: 'main' }),
      })
      .run();
    await reconcileAndDrain();

    expect(queueRows()).toEqual([]);
    expect(requestsNaming(X)).toEqual([]);
    expect(requestsNaming(Y)).toEqual([]);
    expect(requests.filter((r) => r.method === 'POST' && r.url === '/work-items')).toEqual([]);
    expect(workItem(X)).toMatchObject({ ownerAccountId: A_ID });
    expect(syncQueueService.getFailedOperations()).toEqual([]);
  });

  it("re-attributes an item marked another account's once it appears in the signed-in account's own listing", async () => {
    db.update(workItems)
      .set({ ownerAccountId: OWNED_BY_ANOTHER_ACCOUNT, cloudId: null, syncedAt: null })
      .where(eq(workItems.id, Y))
      .run();
    cloudListing = [Y];

    await reconcileAndDrain();

    expect(workItem(Y)).toMatchObject({ ownerAccountId: B_ID, cloudId: Y });
    expect(workItem(Y)?.syncedAt).toBeGreaterThan(0);
    expect(requests.filter((r) => r.method === 'POST' && r.url === '/work-items')).toEqual([]);
  });
});
