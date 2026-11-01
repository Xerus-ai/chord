import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The local half of the rail's counts (shared-items step 1, S8): per artifact
 * of a work item, the open comment threads kept on this device and the latest
 * version, in one grouped read. Real SQLite from the shipped migrations.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifactComments, artifacts, artifactVersions } = await import('@main/db/schema-artifacts');
const { listLocalRailSummary } = await import('./list-local-rail-summary');

const WORK_ITEM_ID = 'w-rail';
const OTHER_WORK_ITEM_ID = 'w-rail-other';

function addComment(
  id: string,
  artifactId: string,
  options: { parentCommentId?: string; resolved?: boolean } = {}
) {
  db.insert(artifactComments)
    .values({
      id,
      artifactId,
      body: id,
      authorName: 'ada@example.com',
      parentCommentId: options.parentCommentId ?? null,
      resolved: options.resolved ? 1 : 0,
    })
    .run();
}

function addVersions(artifactId: string, count: number) {
  for (let n = 1; n <= count; n++) {
    db.insert(artifactVersions)
      .values({ id: `${artifactId}-v${n}`, artifactId, versionNumber: n })
      .run();
  }
}

beforeAll(async () => {
  await db.insert(repos).values({ id: 'r-rail', alias: 'repo', path: 'D:/rail-repo' });
  await db.insert(workItems).values([
    { id: WORK_ITEM_ID, repoId: 'r-rail', repoPath: 'D:/rail-repo', name: 'Rail' },
    { id: OTHER_WORK_ITEM_ID, repoId: 'r-rail', repoPath: 'D:/rail-repo', name: 'Other' },
  ]);
  await db.insert(artifacts).values([
    // (work item, file path) is unique, so each artifact has its own file.
    { id: 'a-plan', workItemId: WORK_ITEM_ID, name: 'plan.md', filePath: 'D:/rail-repo/plan.md' },
    {
      id: 'a-page',
      workItemId: WORK_ITEM_ID,
      name: 'index.html',
      filePath: 'D:/rail-repo/index.html',
    },
    { id: 'a-bare', workItemId: WORK_ITEM_ID, name: 'bare.md', filePath: 'D:/rail-repo/bare.md' },
    {
      id: 'a-elsewhere',
      workItemId: OTHER_WORK_ITEM_ID,
      name: 'elsewhere.md',
      filePath: 'D:/rail-repo/elsewhere.md',
    },
  ]);

  addComment('c-open', 'a-plan');
  addComment('c-reply', 'a-plan', { parentCommentId: 'c-open' });
  addComment('c-resolved', 'a-plan', { resolved: true });
  addComment('c-open-2', 'a-plan');
  addComment('c-page', 'a-page');
  addComment('c-elsewhere', 'a-elsewhere');
  addVersions('a-plan', 4);
  addVersions('a-elsewhere', 2);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('listLocalRailSummary', () => {
  it('counts open threads and the latest version for each artifact of the work item', () => {
    const rows = listLocalRailSummary(WORK_ITEM_ID);

    expect([...rows].sort((a, b) => a.artifactId.localeCompare(b.artifactId))).toEqual([
      { artifactId: 'a-bare', openComments: 0, latestVersion: null },
      { artifactId: 'a-page', openComments: 1, latestVersion: null },
      // A reply belongs to its thread, and a resolved thread is not open.
      { artifactId: 'a-plan', openComments: 2, latestVersion: 4 },
    ]);
  });

  it('returns nothing for a work item without artifacts', () => {
    expect(listLocalRailSummary('w-none')).toEqual([]);
  });
});
