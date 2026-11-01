import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { repos, workItems, workItemWorktrees } = await import('@main/db/schema-work-items');
const { readArchivedLaneCounts } = await import('./sidebar-counts');

/**
 * The sidebar lists a work item's archived lanes under it as "Archived (n)"
 * (plan §"Decisions for Phase 5", Restore), so its summary carries how many
 * there are, read in the same round trip as the rest. Real migrated DB.
 */
describe('readArchivedLaneCounts', () => {
  it('counts each work item’s archived lanes, and nothing for one without', async () => {
    await db.insert(repos).values({ id: 'repo-1', alias: 'repo', path: '/r' });
    await db.insert(workItems).values([
      { id: 'item-a', name: 'a', repoId: 'repo-1', repoPath: '/r' },
      { id: 'item-b', name: 'b', repoId: 'repo-1', repoPath: '/r' },
    ]);
    await db.insert(workItemWorktrees).values([
      { id: 'a-1', workItemId: 'item-a', path: '/r/a1', isPrimary: 1 },
      { id: 'a-2', workItemId: 'item-a', path: '/r/a2', isPrimary: 0, archivedAt: 10 },
      { id: 'a-3', workItemId: 'item-a', path: '/r/a3', isPrimary: 0, archivedAt: 20 },
      { id: 'b-1', workItemId: 'item-b', path: '/r/b1', isPrimary: 1 },
    ]);

    const counts = await readArchivedLaneCounts(['item-a', 'item-b']);

    expect(counts.get('item-a')).toBe(2);
    expect(counts.has('item-b')).toBe(false);
  });
});
