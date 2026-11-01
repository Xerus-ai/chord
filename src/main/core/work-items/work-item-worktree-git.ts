import { stat } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeRefSegment, toBranchSlug } from '@shared/git-branch-name';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';

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
 * will normally hold uncommitted or untracked files.
 */
export async function removeWorkItemWorktree(worktreePath: string): Promise<void> {
  if (!(await isLinkedWorktree(worktreePath))) return;

  const mainRepoPath = await resolveMainRepoPath(worktreePath);
  const ctx = new LocalExecutionContext({ root: mainRepoPath });
  await ctx.exec(GIT_EXECUTABLE, ['worktree', 'remove', '--force', worktreePath]);
  await ctx.exec(GIT_EXECUTABLE, ['worktree', 'prune']).catch(() => {});

  log.info('[work-items] removed worktree', { worktreePath, mainRepoPath });
}

/**
 * Removes a lane's checkout, unless the user adopted it (plan §Phase 3 slice
 * 6): an adopted checkout is the user's, and Chord never changes it or git's
 * worktree list. The guard keys on `checkout_origin`, not on the folder — an
 * adopted folder is a linked worktree, which `removeWorkItemWorktree` removes.
 */
export async function removeLaneCheckout(lane: {
  id: string;
  path: string;
  checkoutOrigin: string;
}): Promise<void> {
  if (lane.checkoutOrigin === 'adopted') {
    log.info('[work-items] left an adopted checkout in place', {
      worktreeId: lane.id,
      path: lane.path,
    });
    return;
  }
  await removeWorkItemWorktree(lane.path);
}
