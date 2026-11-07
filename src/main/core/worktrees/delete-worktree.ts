import { stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import { announceSessionsChanged } from '@main/core/agent-sessions/announce-sessions-changed';
import { forgetEndedSession } from '@main/core/agent-sessions/forget-ended-session';
import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import { deleteWorktreeCheckpoints } from '@main/core/checkpoints/checkpoint-service';
import {
  releaseLaneSoloForRemoval,
  type SoloRemovalRefusal,
} from '@main/core/solo/solo-lane-removal';
import { comparablePath } from '@main/core/utils/comparable-path';
import { stopWorktreeSessions } from '@main/core/work-items/stop-checkout-sessions';
import {
  checkLaneRemovable,
  removeLaneCheckout,
  type LaneRemovalRefusal,
} from '@main/core/work-items/work-item-worktree-git';
import { db } from '@main/db/client';
import { agentSessions, repos, workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { planWorktreeDelete, type DeleteWorktreeDecisionError } from './decisions';
import { releaseArchiveRefs } from './lane-archive-git';
import { cancelLaneWaiters } from './lane-readiness';
import { releaseWorktreeWorkspace } from './workspace-bridge';
import { scheduleWorktreeCloudSync } from './worktree-cloud-sync';
import { findWorktreeRow, getPrimaryWorktreeRow } from './worktree-lookup';

export type DeleteWorktreeError =
  | { type: 'not_found' }
  | DeleteWorktreeDecisionError
  | SoloRemovalRefusal
  | LaneRemovalRefusal
  | { type: 'checkpoint_cleanup_failed'; message: string }
  | { type: 'checkout_remove_failed'; message: string };

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * A folder that belongs to the user, not to a lane: a registered repository
 * (which can itself be a linked worktree, so "is it linked" is no guard), or
 * any main checkout — `.git` is a directory there, a file in a linked one.
 */
async function isRepoCheckout(folder: string): Promise<boolean> {
  const target = comparablePath(folder);
  const registered = db.select({ path: repos.path }).from(repos).all();
  if (registered.some((repo) => comparablePath(repo.path) === target)) return true;
  try {
    return (await stat(path.join(folder, '.git'))).isDirectory();
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

/**
 * Deletes one secondary lane: its checkout goes, its branch stays — the same
 * contract as deleting a work item (`deleteWorkItem`) and the same order as
 * `archiveWorktree`:
 *
 * 0. A companion checkout the lane is nested in must hold nothing a removal
 *    would lose (`checkLaneRemovable`), checked before anything changes.
 * 1. Waiters are cancelled, sessions stopped and the workspace released
 *    first. On Windows `git worktree remove` fails while a terminal or a
 *    lifecycle process has its cwd inside the checkout, and releasing the
 *    workspace is what runs the teardown script, under the trust rules
 *    (`releaseWorktreeWorkspace` asks about an unapproved one).
 * 2. Checkpoint refs, and the archive snapshot of an archived lane, are
 *    released while the rows still say which refs are the lane's; a failure
 *    stops here, before anything is lost.
 * 3. The checkout is removed. A failure keeps the rows, so Delete can be
 *    retried rather than leaving a folder nothing records.
 * 4. The lane row and the sessions bound to it go in one transaction. The
 *    sessions are deleted, not left to the FK's ON DELETE SET NULL: a null
 *    `worktree_id` means the primary, so they would re-bind to it.
 */
export async function deleteWorktree(
  worktreeId: string
): Promise<Result<{ workItemId: string }, DeleteWorktreeError>> {
  const row = findWorktreeRow(worktreeId);
  if (!row) return err({ type: 'not_found' as const });

  const plan = planWorktreeDelete({
    isPrimary: row.isPrimary === 1,
    path: row.path,
    isRepoCheckout: await isRepoCheckout(row.path),
  });
  if (!plan.success) return err(plan.error);
  const removable = await checkLaneRemovable(row);
  if (!removable.success) return removable;
  // Out of the Solo queue, or its Solo released, before anything goes.
  const solo = await releaseLaneSoloForRemoval(worktreeId);
  if (!solo.success) return solo;

  cancelLaneWaiters(worktreeId, 'lane deleted');
  await stopWorktreeSessions(worktreeId);
  await releaseWorktreeWorkspace(worktreeId);

  // Refs live in the repo's shared object store, so the primary — which is
  // guaranteed to exist — releases them even if this checkout is gone (an
  // archived lane's never is). Its archive snapshot goes with its checkpoints.
  try {
    const primaryPath = getPrimaryWorktreeRow(row.workItemId).path;
    await deleteWorktreeCheckpoints(worktreeId, primaryPath);
    await releaseArchiveRefs(primaryPath, [worktreeId]);
  } catch (error) {
    log.error('[worktrees] failed to release checkpoint refs before delete', {
      worktreeId,
      error: String(error),
    });
    return err({ type: 'checkpoint_cleanup_failed' as const, message: String(error) });
  }

  try {
    await removeLaneCheckout(row);
  } catch (error) {
    log.error('[worktrees] failed to remove the checkout of a deleted lane', {
      worktreeId,
      path: row.path,
      error: String(error),
    });
    return err({ type: 'checkout_remove_failed' as const, message: String(error) });
  }

  const sessionIds = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(eq(agentSessions.worktreeId, worktreeId))
    .all()
    .map((session) => session.id);
  db.transaction((tx) => {
    tx.delete(agentSessions).where(eq(agentSessions.worktreeId, worktreeId)).run();
    tx.delete(workItemWorktrees).where(eq(workItemWorktrees.id, worktreeId)).run();
  });
  for (const sessionId of sessionIds) forgetEndedSession(sessionId);

  log.info('[worktrees] deleted lane', {
    workItemId: row.workItemId,
    worktreeId,
    branchName: row.branchName,
    sessions: sessionIds.length,
  });
  scheduleWorktreeCloudSync(row.workItemId);
  if (sessionIds.length > 0) {
    scheduleSessionCloudSync(row.workItemId);
    announceSessionsChanged(row.workItemId);
  }
  return ok({ workItemId: row.workItemId });
}
