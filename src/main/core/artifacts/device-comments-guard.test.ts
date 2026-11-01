import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The device keeps comments only for an artifact that has not reached the
 * cloud (devstation-85y). Once it has a cloud id its comments live there, and
 * a comments card still holding the device store (it was open while the
 * artifact synced) must be told so rather than read an emptied list or write
 * a comment nobody else will see. Real SQLite; the signed-in account goes
 * through the real account path.
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
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifactComments, artifacts } = await import('@main/db/schema-artifacts');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { artifactsController } = await import('./controller');

const WORK_ITEM_ID = 'w-guard';
const DEVICE_ID = 'a-device';
const CLOUD_ID = 'a-cloud';
const IN_CLOUD = { success: false, error: { type: 'artifact_in_cloud' } };

beforeAll(async () => {
  await signInTestAccount({ username: 'guard', email: 'guard@example.com' });
  await db.insert(repos).values({ id: 'r-guard', alias: 'repo', path: '/tmp/guard' });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    name: 'Guard',
    repoId: 'r-guard',
    repoPath: '/tmp/guard',
  });
  await db.insert(artifacts).values(
    [DEVICE_ID, CLOUD_ID].map((id) => ({
      id,
      workItemId: WORK_ITEM_ID,
      filePath: `/tmp/guard/${id}.md`,
      name: `${id}.md`,
      type: 'markdown',
      contentType: 'markdown',
      cloudId: id === CLOUD_ID ? CLOUD_ID : null,
    }))
  );
});

beforeEach(() => {
  db.delete(artifactComments).run();
  db.insert(artifactComments)
    .values([
      { id: 'c-device', artifactId: DEVICE_ID, body: 'kept here', authorName: 'guard' },
      { id: 'c-left', artifactId: CLOUD_ID, body: 'left behind', authorName: 'guard' },
    ])
    .run();
});

describe('the device comment store', () => {
  it('serves an artifact that has not reached the cloud', async () => {
    const listed = artifactsController.listComments({ artifactId: DEVICE_ID });
    expect(listed.success && listed.data.comments.map((c) => c.id)).toEqual(['c-device']);

    const added = await artifactsController.addComment({ artifactId: DEVICE_ID, body: 'more' });
    expect(added.success).toBe(true);
    expect(artifactsController.resolveComment({ commentId: 'c-device' })).toMatchObject({
      success: true,
    });
    expect(artifactsController.unresolveComment({ commentId: 'c-device' })).toMatchObject({
      success: true,
    });
  });

  it('refuses every read and write for an artifact that has a cloud id', async () => {
    expect(artifactsController.listComments({ artifactId: CLOUD_ID })).toMatchObject(IN_CLOUD);
    expect(
      await artifactsController.addComment({ artifactId: CLOUD_ID, body: 'too late' })
    ).toMatchObject(IN_CLOUD);
    expect(artifactsController.resolveComment({ commentId: 'c-left' })).toMatchObject(IN_CLOUD);
    expect(artifactsController.unresolveComment({ commentId: 'c-left' })).toMatchObject(IN_CLOUD);

    const rows = db
      .select()
      .from(artifactComments)
      .where(eq(artifactComments.artifactId, CLOUD_ID))
      .all();
    expect(rows).toMatchObject([{ id: 'c-left', resolved: 0 }]);
  });
});
