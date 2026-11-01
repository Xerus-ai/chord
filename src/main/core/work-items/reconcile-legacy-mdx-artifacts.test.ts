import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Legacy `.mdx` artifacts that reached the cloud as markdown documents are
 * re-registered as pages exactly once (design 2026-09-24 §9 decision 2). The
 * local migration retypes them to `mdx` and clears `synced_at`
 * (legacy-mdx-artifacts-migration.test.ts); the startup reconcile then queues
 * the artifact create, whose payload the server upserts over content_type and
 * render_class. The queue row is durable; a successful send stamps
 * `synced_at`, after which the row is never registered again.
 *
 * Real SQLite from the shipped migrations; the reconcile runs signed in, so
 * the suite signs in through the real account path (`_testing/test-account.ts`).
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

const WORK_ITEM_ID = 'w-legacy-mdx';
const RETYPED_ID = 'a-retyped-mdx';
const SYNCED_ID = 'a-synced-web';

function artifactCreates() {
  return db
    .select()
    .from(syncQueue)
    .where(eq(syncQueue.entityType, 'artifact'))
    .orderBy(asc(syncQueue.id))
    .all()
    .map((row) => ({
      entityId: row.entityId,
      operation: row.operation,
      body: JSON.parse(row.payload),
    }));
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  await db.insert(repos).values({ id: 'r-legacy-mdx', alias: 'repo', path: '/tmp/legacy-mdx' });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-legacy-mdx',
    repoPath: '/tmp/legacy-mdx',
    name: 'Legacy MDX',
  });
});

beforeEach(async () => {
  db.delete(syncQueue).run();
  db.delete(artifacts).run();
  // As the migration leaves them: the retyped row unsynced, the rest untouched.
  await db.insert(artifacts).values([
    {
      id: RETYPED_ID,
      workItemId: WORK_ITEM_ID,
      filePath: '/tmp/legacy-mdx/flow.mdx',
      name: 'flow.mdx',
      type: 'mdx',
      contentType: 'mdx',
      cloudId: RETYPED_ID,
      syncedAt: null,
    },
    {
      id: SYNCED_ID,
      workItemId: WORK_ITEM_ID,
      filePath: '/tmp/legacy-mdx/page.html',
      name: 'page.html',
      type: 'web',
      contentType: 'web',
      cloudId: SYNCED_ID,
      syncedAt: 1_790_000_000,
    },
  ]);
});

afterEach(() => {
  // The reconcile kicks a drain; this suite asserts on the queue, not on sends.
  syncQueueService.dispose();
});

describe('reconcileLocalArtifacts — retyped legacy .mdx rows', () => {
  it('queues one artifact create that registers the row as a page, and no second one on the next startup', async () => {
    await syncQueueService.reconcileLocalArtifacts();
    // The next startup, before the create has been delivered.
    await syncQueueService.reconcileLocalArtifacts();
    expect(artifactCreates()).toEqual([
      {
        entityId: RETYPED_ID,
        operation: 'create',
        body: {
          work_item_id: WORK_ITEM_ID,
          name: 'flow.mdx',
          content_type: 'mdx',
          render_class: 'page',
          status: 'draft',
        },
      },
    ]);
  });

  it('replaces a create still queued with the old document payload instead of adding a second', async () => {
    db.insert(syncQueue)
      .values({
        entityType: 'artifact',
        operation: 'create',
        entityId: RETYPED_ID,
        payload: JSON.stringify({
          work_item_id: WORK_ITEM_ID,
          name: 'flow.mdx',
          content_type: 'markdown',
          render_class: 'document',
        }),
      })
      .run();
    await syncQueueService.reconcileLocalArtifacts();
    await syncQueueService.reconcileLocalArtifacts();

    const creates = artifactCreates();
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toMatchObject({ content_type: 'mdx', render_class: 'page' });
  });

  it('registers the row once: after the send stamps synced_at, nothing is queued again', async () => {
    await syncQueueService.reconcileLocalArtifacts();
    expect(artifactCreates()).toHaveLength(1);

    // What a successful send leaves behind (sync-queue-service sendOperation).
    db.delete(syncQueue).run();
    db.update(artifacts).set({ syncedAt: 1_790_000_100 }).where(eq(artifacts.id, RETYPED_ID)).run();

    await syncQueueService.reconcileLocalArtifacts();
    expect(artifactCreates()).toEqual([]);
  });
});
