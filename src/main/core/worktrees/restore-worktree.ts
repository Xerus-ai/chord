import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { Worktree } from '@shared/worktrees';
import { restoreCheckpointCommit } from '@main/core/checkpoints/checkpoint-git';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { db } from '@main/db/client';
import { workItemWorktrees, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import {
  branchExists,
  readArchiveSnapshot,
  releaseArchiveRefs,
  restoreLaneCheckout,
} from './lane-archive-git';
import { runLaneSetup } from './lane-setup';
import { toWorktreeDto } from './service';
import { acquireWorktreeWorkspace } from './workspace-bridge';
import { scheduleWorktreeCloudSync } from './worktree-cloud-sync';
import { findWorktreeRow, getPrimaryWorktreeRow } from './worktree-lookup';

export type RestoreWorktreeError =
  | { type: 'not_found' }
  | { type: 'not_archived' }
  | { type: 'branch_missing' }
  | { type: 'checkout_missing'; path: string }
  | { type: 'branch_checked_out'; path: string };

async function reopenLane(row: WorkItemWorktreeRow, runSetup: boolean): Promise<Worktree> {
  // The workspace first: the moment the lane reads as live, the rail reads its
  // git state through it (devstation-b3d4). As at create, a lane with no
  // workspace backend yet is still usable, and boot acquisition retries it.
  try {
    await acquireWorktreeWorkspace(row);
  } catch (error) {
    log.warn('[worktrees] could not acquire workspace for restored lane', {
      worktreeId: row.id,
      error: String(error),
    });
  }
  await db
    .update(workItemWorktrees)
    .set({ archivedAt: null, ...(runSetup ? { setupStatus: 'pending' } : {}) })
    .where(eq(workItemWorktrees.id, row.id));
  const updated = findWorktreeRow(row.id);
  if (!updated) throw new Error(`Restored worktree ${row.id} but could not read it back`);
  // Records its own outcome (setup_status + log) and never rejects.
  if (runSetup) void runLaneSetup(row.id, askScriptApproval);
  scheduleWorktreeCloudSync(row.workItemId);
  return toWorktreeDto(updated);
}

/**
 * Restore (plan §"Decisions for Phase 5"): the archived lane's checkout comes
 * back at its own path from its branch, with the archive snapshot written over
 * it uncommitted (index at HEAD), and setup runs again. The snapshot's ref is
 * released once its work is back in the checkout. A lane whose branch was
 * deleted has nothing to restore from. An adopted checkout was never
 * removed: it is only shown again, if the user's folder is still there.
 */
export async function restoreWorktree(
  worktreeId: string
): Promise<Result<Worktree, RestoreWorktreeError>> {
  const row = findWorktreeRow(worktreeId);
  if (!row) return err({ type: 'not_found' as const });
  if (row.archivedAt === null) return err({ type: 'not_archived' as const });

  if (row.checkoutOrigin === 'adopted') {
    if (!existsSync(row.path)) return err({ type: 'checkout_missing' as const, path: row.path });
    return ok(await reopenLane(row, false));
  }

  const repoPath = getPrimaryWorktreeRow(row.workItemId).path;
  if (row.branchName === null || !(await branchExists(repoPath, row.branchName))) {
    return err({ type: 'branch_missing' as const });
  }
  const refused = await restoreLaneCheckout(repoPath, row.path, row.branchName);
  if (refused) return err(refused);

  const snapshot = await readArchiveSnapshot(repoPath, row.id);
  if (snapshot !== null) {
    await restoreCheckpointCommit(row.path, snapshot);
    await releaseArchiveRefs(repoPath, [row.id]);
  }
  log.info('[worktrees] restored lane', {
    worktreeId,
    branchName: row.branchName,
    keptWork: snapshot !== null,
  });
  return ok(await reopenLane(row, true));
}
