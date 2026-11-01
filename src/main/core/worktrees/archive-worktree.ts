import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { Worktree } from '@shared/worktrees';
import {
  releaseLaneSoloForRemoval,
  type SoloRemovalRefusal,
} from '@main/core/solo/solo-lane-removal';
import { stopWorktreeSessions } from '@main/core/work-items/stop-checkout-sessions';
import { removeLaneCheckout } from '@main/core/work-items/work-item-worktree-git';
import { db } from '@main/db/client';
import { workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { canDeleteLaneBranch } from './archive-branch-delete';
import { inspectWorktreeGitState } from './archive-inspect';
import {
  planWorktreeArchive,
  type ArchiveWorktreeError as ArchiveDecisionError,
} from './decisions';
import { deleteLaneBranch, snapshotLaneForArchive } from './lane-archive-git';
import { cancelLaneWaiters } from './lane-readiness';
import { toWorktreeDto } from './service';
import { releaseWorktreeWorkspace } from './workspace-bridge';
import { scheduleWorktreeCloudSync } from './worktree-cloud-sync';
import { findWorktreeRow, getPrimaryWorktreeRow } from './worktree-lookup';

export type ArchiveWorktreeError =
  | { type: 'not_found' }
  | { type: 'branch_not_deletable' }
  | SoloRemovalRefusal
  | ArchiveDecisionError;

/**
 * Archive (plan §"Decisions for Phase 5"): the lane's checkout goes, and
 * everything else is kept. Its sessions stop and its Solo is released; its
 * uncommitted work (tracked and untracked, not ignored) is snapshotted at
 * `refs/chord/archive/<laneId>`; its checkpoints and its branch stay, so its
 * chat history can still be reset to and forked from, and Restore brings the
 * checkout back.
 *
 * `deleteBranch` also deletes the branch, which only a lane that loses
 * nothing may do (`decideArchiveBranchDelete`); asked anyway, the archive is
 * refused before anything changes. An adopted checkout is the user's: it is
 * only marked archived, never snapshotted or removed.
 */
export async function archiveWorktree(
  worktreeId: string,
  opts: { deleteBranch?: boolean } = {}
): Promise<Result<Worktree, ArchiveWorktreeError>> {
  const row = findWorktreeRow(worktreeId);
  if (!row) return err({ type: 'not_found' as const });

  const plan = planWorktreeArchive({ isPrimary: row.isPrimary === 1, archivedAt: row.archivedAt });
  if (!plan.success) return err(plan.error);
  if (opts.deleteBranch) {
    const { uncommitted } = await inspectWorktreeGitState(row.path);
    if (!(await canDeleteLaneBranch(row, uncommitted))) {
      return err({ type: 'branch_not_deletable' as const });
    }
  }
  // Out of the Solo queue, or its Solo released, before anything goes.
  const solo = await releaseLaneSoloForRemoval(worktreeId);
  if (!solo.success) return solo;

  // Before removing the checkout: on Windows, `git worktree remove` fails
  // while a lifecycle terminal or any other process still has its cwd inside
  // the checkout, which is exactly what an acquired workspace and the lane's
  // own sessions (a terminal tab) hold open.
  cancelLaneWaiters(worktreeId, 'lane archived');
  await stopWorktreeSessions(worktreeId);
  await releaseWorktreeWorkspace(worktreeId);

  // A checkout already gone from disk (deleted by hand) has nothing to keep.
  if (row.checkoutOrigin !== 'adopted' && existsSync(row.path)) {
    await snapshotLaneForArchive(row.path, row.id);
  }
  await removeLaneCheckout(row);
  if (opts.deleteBranch && row.branchName !== null) {
    await deleteLaneBranch(getPrimaryWorktreeRow(row.workItemId).path, row.branchName);
  }
  await db
    .update(workItemWorktrees)
    .set({ archivedAt: Math.floor(Date.now() / 1000) })
    .where(eq(workItemWorktrees.id, worktreeId));

  log.info('[worktrees] archived lane', {
    worktreeId,
    branchName: row.branchName,
    branchDeleted: Boolean(opts.deleteBranch),
  });
  const updated = findWorktreeRow(worktreeId);
  if (!updated) throw new Error(`Archived worktree ${worktreeId} but could not read it back`);
  scheduleWorktreeCloudSync(updated.workItemId);
  return ok(toWorktreeDto(updated));
}
