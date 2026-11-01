import { existsSync } from 'node:fs';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { ArchivedLane } from '@shared/worktrees';
import { db } from '@main/db/client';
import { workItemWorktrees } from '@main/db/schema-work-items';
import { branchExists, countArchivedChanges, readArchiveSnapshot } from './lane-archive-git';
import { getPrimaryWorktreeRow } from './worktree-lookup';

/**
 * A work item's archived lanes, oldest archive first, as the left rail's
 * "Archived (n)" group lists them: whether each can be restored (its branch
 * is still here, or for an adopted checkout, its folder), and how many files
 * its archive keeps uncommitted.
 */
export async function listArchivedLanes(workItemId: string): Promise<ArchivedLane[]> {
  const rows = db
    .select()
    .from(workItemWorktrees)
    .where(
      and(eq(workItemWorktrees.workItemId, workItemId), isNotNull(workItemWorktrees.archivedAt))
    )
    .orderBy(asc(workItemWorktrees.archivedAt))
    .all();
  if (rows.length === 0) return [];
  const repoPath = getPrimaryWorktreeRow(workItemId).path;

  return Promise.all(
    rows.map(async (row) => {
      const snapshot = await readArchiveSnapshot(repoPath, row.id);
      const restorable =
        row.checkoutOrigin === 'adopted'
          ? existsSync(row.path)
          : row.branchName !== null && (await branchExists(repoPath, row.branchName));
      return {
        id: row.id,
        branchName: row.branchName,
        title: row.title,
        restorable,
        keptChanges: snapshot === null ? 0 : await countArchivedChanges(repoPath, snapshot),
      };
    })
  );
}
