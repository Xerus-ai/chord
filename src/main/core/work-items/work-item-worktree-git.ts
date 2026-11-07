import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeRefSegment, toBranchSlug } from '@shared/git-branch-name';
import { err, ok, type Result } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import {
  checkCompanionRemovable,
  deleteCompanionBranch,
  provisionCompanionCheckout,
  removeCompanionCheckout,
  type CompanionRepo,
} from './companion-checkout';
import { removeHeldWorktree } from './remove-held-worktree';

/**
 * The git-level half of per-work-item worktrees: naming a branch and releasing a
 * worktree. Neither needs any app configuration, so this module deliberately
 * imports nothing that reaches the settings store or the database — which is
 * what lets the destructive `git worktree remove` path below be tested against
 * a real repository with no Electron runtime and no mocks.
 *
 * Acquiring a worktree does need configuration and lives in
 * `work-item-worktree.ts`.
 */

/**
 * Shape matches the preview Settings › Git shows for the branch prefix
 * (`BranchPrefixCard` — "octocat/my-feature-a3f"). The prefix is already
 * resolved (`resolve-branch-prefix.ts`); empty means none.
 */
export function buildWorkItemBranchName(args: {
  name: string;
  workItemId: string;
  branchPrefix: string;
}): string {
  const slug = toBranchSlug(args.name);
  const suffix = args.workItemId
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toLowerCase();
  const prefix = sanitizeRefSegment(args.branchPrefix);
  const leaf = suffix ? `${slug}-${suffix}` : slug;
  return prefix ? `${prefix}/${leaf}` : leaf;
}

/**
 * A linked worktree has `.git` as a *file* pointing back at the main repo; a
 * normal checkout has it as a directory. That distinction is what keeps this
 * from ever running `git worktree remove` against a user's actual repository —
 * work items created before worktrees shipped still hold the repo root as their
 * `repoPath`, and must be left alone.
 */
async function isLinkedWorktree(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(path.join(candidatePath, '.git'))).isFile();
  } catch {
    return false;
  }
}

/**
 * `git worktree remove` needs to run against the main checkout, not the linked
 * one. Also used by the worktrees controller to find the repo a non-primary
 * worktree should fork its branch from, when the work item has no `repos` row.
 */
export async function resolveMainRepoPath(worktreePath: string): Promise<string> {
  const ctx = new LocalExecutionContext({ root: worktreePath });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--git-common-dir']);
  // Relative for a main checkout, absolute for a linked worktree — resolve covers both.
  return path.dirname(path.resolve(worktreePath, stdout.trim()));
}

/**
 * Releases the worktree a deleted work item was using.
 *
 * The **branch is deliberately left behind**. `git worktree remove` frees the
 * directory and the checkout but touches no refs, so commits made in the work
 * item survive its deletion. An orphaned branch costs nothing; unrecoverable
 * commits do — and this repo still has no remote to have pushed them to.
 *
 * `--force` because the work item is being deleted on purpose and its worktree
 * will normally hold uncommitted or untracked files. A brief hold on the folder
 * (Windows) is waited out (`remove-held-worktree.ts`).
 */
export async function removeWorkItemWorktree(worktreePath: string): Promise<void> {
  if (!(await isLinkedWorktree(worktreePath))) return;

  const mainRepoPath = await resolveMainRepoPath(worktreePath);
  await removeHeldWorktree({ repoPath: mainRepoPath, worktreePath, force: true });

  log.info('[work-items] removed worktree', { worktreePath, mainRepoPath });
}

/** What removing a lane reads from its row. */
export interface LaneCheckoutRow {
  id: string;
  path: string;
  checkoutOrigin: string;
  companionPath: string | null;
  companionRepoPath: string | null;
}

/**
 * The companion half of a lane still on disk, as `companion-checkout.ts`
 * takes it: its main checkout, and the folder the lane's checkout is nested
 * at, read off the two paths the row recorded (the setting may have changed
 * since the lane was made).
 */
function recordedCompanion(
  lane: LaneCheckoutRow
): { companion: CompanionRepo; companionPath: string } | null {
  if (lane.companionPath === null || lane.companionRepoPath === null) return null;
  return {
    companion: {
      path: lane.companionRepoPath,
      appFolder: path.relative(lane.companionPath, lane.path),
    },
    companionPath: lane.companionPath,
  };
}

/** The companion half still on disk, which removing the lane takes along. */
function laneCompanion(lane: LaneCheckoutRow) {
  const paired = recordedCompanion(lane);
  return paired && existsSync(paired.companionPath) ? paired : null;
}

export type LaneCompanionRestoreError = { type: 'companion_failed'; message: string };

/**
 * Restore's companion half, made again where the row recorded it, from the
 * companion branch its archive left, before the lane's own checkout goes back
 * inside it. Returns the undo for a lane checkout that is then refused, which
 * also deletes a companion branch this restore had to make.
 */
export async function restoreLaneCompanion(
  lane: LaneCheckoutRow,
  branchName: string
): Promise<Result<() => Promise<void>, LaneCompanionRestoreError>> {
  const paired = recordedCompanion(lane);
  if (!paired) return ok(async () => {});
  const made = await provisionCompanionCheckout({
    companion: paired.companion,
    poolPath: path.dirname(paired.companionPath),
    slug: path.basename(paired.companionPath),
    laneBranch: branchName,
  });
  if (!made.success) {
    return err({
      type: 'companion_failed',
      message: `Companion repository: ${made.error.message}`,
    });
  }
  const { branchCreated, companionBranch } = made.data;
  return ok(async () => {
    const removed = await removeCompanionCheckout(paired);
    if (!removed.success) throw new Error(removed.error.message);
    // A branch this restore made (its companion branch was gone) goes too, as at create.
    if (branchCreated) await deleteCompanionBranch(paired.companion.path, companionBranch);
  });
}

export type LaneRemovalRefusal = { type: 'companion_has_changes'; path: string; message: string };

/**
 * Run before a lane's removal changes anything (sessions, refs, checkout):
 * its companion half must hold nothing a removal would lose, or the lane
 * would be gone with its companion left behind.
 */
export async function checkLaneRemovable(
  lane: LaneCheckoutRow
): Promise<Result<void, LaneRemovalRefusal>> {
  const paired = laneCompanion(lane);
  if (!paired) return ok();
  const removable = await checkCompanionRemovable(paired);
  if (removable.success) return ok();
  return err({
    type: 'companion_has_changes',
    path: paired.companionPath,
    message: removable.error.message,
  });
}

/** `checkLaneRemovable` for each of a work item's lanes, before deleting the item. */
export async function checkLanesRemovable(
  lanes: readonly LaneCheckoutRow[]
): Promise<Result<void, LaneRemovalRefusal>> {
  for (const lane of lanes) {
    const removable = await checkLaneRemovable(lane);
    if (!removable.success) return removable;
  }
  return ok();
}

/**
 * Removes a lane's checkout, unless the user adopted it (plan §Phase 3 slice
 * 6): an adopted checkout is the user's, and Chord never changes it or git's
 * worktree list. The guard keys on `checkout_origin`, not on the folder — an
 * adopted folder is a linked worktree, which `removeWorkItemWorktree` removes.
 *
 * A lane nested in a companion worktree takes that worktree along, after its
 * own checkout; the companion branch stays, as the lane's does. Throws when
 * the companion refuses (`removeCompanionCheckout`): callers check
 * `checkLaneRemovable` first, so that is something that changed meanwhile.
 */
export async function removeLaneCheckout(lane: LaneCheckoutRow): Promise<void> {
  if (lane.checkoutOrigin === 'adopted') {
    log.info('[work-items] left an adopted checkout in place', {
      worktreeId: lane.id,
      path: lane.path,
    });
    return;
  }
  await removeWorkItemWorktree(lane.path);
  const paired = laneCompanion(lane);
  if (!paired) return;
  const removed = await removeCompanionCheckout(paired);
  if (!removed.success) throw new Error(removed.error.message);
  log.info('[work-items] removed companion checkout', {
    worktreeId: lane.id,
    companionPath: paired.companionPath,
  });
}
