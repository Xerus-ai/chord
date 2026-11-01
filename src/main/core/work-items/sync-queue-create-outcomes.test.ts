import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a drained create leaves behind, per server answer (devstation-as2):
 *
 * - delivered (201, or 200 for the caller's own id on a retry): the local
 *   work item is stamped as synced — cloud_id, synced_at, cloud_version;
 * - 409 (the id belongs to another creator, routes/work-items.ts): final on
 *   the first answer, not after five backoffs, and never more than one queue
 *   row per entity however many startups re-enqueue it;
 * - 403 on an artifact create (the caller is a viewer of the work item): the
 *   same — final at once, one row.
 *
 * A delivered create is also announced (`onWorkItemCloudCreated`): the device
 * socket joins the item's room then, not on its next minute-long sweep, so a
 * teammate's first messages reach this device's chat_messages at once
 * (devstation-ni0).
 *
 * Real SQLite from the shipped migrations; the account is signed in through
 * the real account path; the sync server is a local HTTP server answering
 * exactly what routes/work-items.ts and routes/work-item-artifacts.ts do.
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
const { artifacts } = await import('@main/db/schema-artifacts');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { syncQueueService } = await import('./sync-queue-service');
const { OWNED_BY_ANOTHER_ACCOUNT } = await import('@shared/work-item-ownership');
const { onWorkItemCloudCreated } = await import('./work-item-cloud-created');

const ORG_ID = 'org-outcomes';
const OWN_ID = '11111111-1111-4111-8111-111111111111';
const TAKEN_ID = '22222222-2222-4222-8222-222222222222';
const VIEWED_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_ID = 'a-viewed';

type CreateAnswer = 'created' | 'own_existing' | 'other_creator';
let createAnswer: CreateAnswer = 'created';
let requests: { method: string | undefined; url: string | undefined }[] = [];
let server: Server;
let announced: string[] = [];
const stopListening = onWorkItemCloudCreated((workItemId) => announced.push(workItemId));
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
      if (req.url === '/work-items' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { id: string };
        if (createAnswer === 'other_creator') {
          return reply(409, { error: 'Work item id already exists' });
        }
        return reply(createAnswer === 'created' ? 201 : 200, {
          id: body.id,
          version_number: 7,
        });
      }
      if (req.url === `/work-items/${VIEWED_ID}/artifacts` && req.method === 'POST') {
        return reply(403, { error: 'Viewers have read-only access' });
      }
      return reply(500, { error: `unexpected ${req.method} ${req.url}` });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function queueRows(entityId: string) {
  return db
    .select()
    .from(syncQueue)
    .where(eq(syncQueue.entityId, entityId))
    .orderBy(asc(syncQueue.id))
    .all();
}

function localWorkItem(id: string) {
  return db.select().from(workItems).where(eq(workItems.id, id)).get();
}

function enqueueCreate(id: string, name: string): void {
  syncQueueService.enqueueCreate({
    id,
    name,
    status: 'active',
    general_access: 'invited',
    general_role: 'view',
  });
}

beforeAll(async () => {
  await signInTestAccount({ username: 'outcomes', email: 'outcomes@example.com' });
  process.env.CHORD_CLOUD_API_URL = await startSyncServer();
  await db.insert(repos).values({ id: 'r-outcomes', alias: 'repo', path: '/tmp/outcomes' });
  await db.insert(workItems).values(
    [
      [OWN_ID, 'Mine'],
      [TAKEN_ID, 'Taken'],
      [VIEWED_ID, 'Viewed'],
    ].map(([id, name]) => ({ id, name, repoId: 'r-outcomes', repoPath: '/tmp/outcomes' }))
  );
  await db.insert(artifacts).values({
    id: ARTIFACT_ID,
    workItemId: VIEWED_ID,
    filePath: '/tmp/outcomes/plan.md',
    name: 'plan.md',
    type: 'markdown',
    contentType: 'markdown',
  });
});

beforeEach(() => {
  requests = [];
  announced = [];
  createAnswer = 'created';
  db.delete(syncQueue).run();
  db.update(workItems)
    .set({ cloudId: null, syncedAt: null, cloudVersion: null, ownerAccountId: null })
    .run();
});

afterEach(() => {
  // enqueue* kicks a timed drain; every test drains explicitly instead.
  syncQueueService.dispose();
});

afterAll(async () => {
  stopListening();
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

describe('a delivered work-item create', () => {
  it('stamps the local row as synced (201)', async () => {
    enqueueCreate(OWN_ID, 'Mine');
    await syncQueueService.processQueue();

    expect(queueRows(OWN_ID)).toEqual([]);
    expect(localWorkItem(OWN_ID)).toMatchObject({
      cloudId: OWN_ID,
      cloudVersion: 7,
    });
    expect(localWorkItem(OWN_ID)?.syncedAt).toBeGreaterThan(0);
    expect(announced).toEqual([OWN_ID]);
  });

  it("stamps the local row as synced when the server already had the caller's own id (200)", async () => {
    createAnswer = 'own_existing';
    enqueueCreate(OWN_ID, 'Mine');
    await syncQueueService.processQueue();

    expect(queueRows(OWN_ID)).toEqual([]);
    expect(localWorkItem(OWN_ID)).toMatchObject({ cloudId: OWN_ID, cloudVersion: 7 });
    expect(announced).toEqual([OWN_ID]);
  });
});

describe('a work-item create for an id another creator holds (409)', () => {
  it("settles on the first answer: the item is marked another account's, nothing is failed", async () => {
    createAnswer = 'other_creator';
    enqueueCreate(TAKEN_ID, 'Taken');
    await syncQueueService.processQueue();

    expect(queueRows(TAKEN_ID)).toEqual([]);
    expect(syncQueueService.getFailedOperations()).toEqual([]);
    expect(requests.filter((r) => r.url === '/work-items')).toHaveLength(1);
    expect(localWorkItem(TAKEN_ID)).toMatchObject({
      ownerAccountId: OWNED_BY_ANOTHER_ACCOUNT,
      cloudId: null,
      syncedAt: null,
    });
    expect(announced).toEqual([]);
  });

  it('is never queued again for that item, by any enqueue path', async () => {
    createAnswer = 'other_creator';
    enqueueCreate(TAKEN_ID, 'Taken');
    await syncQueueService.processQueue();

    enqueueCreate(TAKEN_ID, 'Taken');
    syncQueueService.enqueueUpdate(TAKEN_ID, { name: 'Renamed' });
    syncQueueService.enqueueGitState(TAKEN_ID, { branch: 'main' } as never);
    syncQueueService.enqueueArtifactCreate('a-taken', {
      work_item_id: TAKEN_ID,
      name: 'plan.md',
      content_type: 'markdown',
      render_class: 'document',
      status: 'draft',
    });
    expect(queueRows(TAKEN_ID)).toEqual([]);
    expect(queueRows('a-taken')).toEqual([]);
  });
});

describe('an artifact create the server refuses for a viewer (403)', () => {
  it('fails on the first answer with the server’s reason', async () => {
    syncQueueService.enqueueArtifactCreate(ARTIFACT_ID, {
      work_item_id: VIEWED_ID,
      name: 'plan.md',
      content_type: 'markdown',
      render_class: 'document',
      status: 'draft',
    });
    await syncQueueService.processQueue();

    const [row] = queueRows(ARTIFACT_ID);
    expect(row).toMatchObject({ status: 'failed', retryCount: 1 });
    expect(row?.errorMessage).toContain('403');
    expect(row?.errorMessage).toContain('Viewers have read-only access');
    expect(requests.filter((r) => r.url?.endsWith('/artifacts'))).toHaveLength(1);
  });
});

describe('startup', () => {
  it('collapses the failed create rows older builds stacked up to one per entity, keeping the newest', () => {
    const stack = (entityId: string, names: string[]) =>
      names.map((name) => ({
        entityType: 'work_item',
        operation: 'create',
        entityId,
        payload: JSON.stringify({ name }),
        status: 'failed',
        retryCount: 5,
        errorMessage: 'HTTP 409: {"error":"Work item id already exists"}',
      }));
    db.insert(syncQueue)
      .values([...stack(TAKEN_ID, ['v1', 'v2', 'v3']), ...stack(OWN_ID, ['w1', 'w2'])])
      .run();

    syncQueueService.initialize();

    expect(queueRows(TAKEN_ID).map((r) => JSON.parse(r.payload))).toEqual([{ name: 'v3' }]);
    expect(queueRows(OWN_ID).map((r) => JSON.parse(r.payload))).toEqual([{ name: 'w2' }]);
  });
});
