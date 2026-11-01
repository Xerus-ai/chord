import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { planPullRequestPush } from '@main/core/git/impl/pull-request-push';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { findWorktreeRowByPath } from '@main/core/worktrees/worktree-lookup';
import { enqueueRepoIndexOp } from './git-index-queue';
import { recordGitOperationOutcome } from './git-operation-status';

const execFileAsync = promisify(execFile);

const ADD_TIMEOUT_MS = 10_000;
const COMMIT_TIMEOUT_MS = 15_000;
const PUSH_TIMEOUT_MS = 30_000;

/**
 * Records this attempt's outcome against the worktree checked out at
 * `repoPath`, then rethrows unchanged — the caller (controller.ts) still
 * gets the original error. A path with no worktree row (should not happen;
 * every checkout this runs against is registered) is silently skipped rather
 * than masking the real git failure with a lookup error.
 */
async function withGitOperationStatus<T>(repoPath: string, op: () => Promise<T>): Promise<T> {
  try {
    const result = await op();
    const worktree = findWorktreeRowByPath(repoPath);
    if (worktree) recordGitOperationOutcome(worktree.id, null);
    return result;
  } catch (error) {
    const worktree = findWorktreeRowByPath(repoPath);
    if (worktree) recordGitOperationOutcome(worktree.id, String(error));
    throw error;
  }
}

/**
 * Stages the whole worktree, commits it under the caller's message and
 * publishes the branch. A work-item branch has no upstream until its first
 * push, so a plain `push` that fails is retried once with `--set-upstream`;
 * anything the retry cannot fix propagates to the caller.
 *
 * Only the staging half holds the repo's index queue: the push is network-bound
 * and would otherwise block a concurrent checkpoint revert for its whole run.
 */
export async function commitAndPushWorkItem(repoPath: string, message: string): Promise<void> {
  await withGitOperationStatus(repoPath, async () => {
    await enqueueRepoIndexOp(repoPath, async () => {
      await execFileAsync(GIT_EXECUTABLE, ['add', '-A'], {
        cwd: repoPath,
        timeout: ADD_TIMEOUT_MS,
      });
      await execFileAsync(GIT_EXECUTABLE, ['commit', '-m', message], {
        cwd: repoPath,
        timeout: COMMIT_TIMEOUT_MS,
      });
    });

    await pushBranch(repoPath);
  });
}

/**
 * Publishes the current branch without touching the worktree. Opening a pull
 * request needs the branch on the remote even when there is nothing left to
 * commit, which is the one case `commitAndPushWorkItem` cannot cover — its
 * `git commit` fails outright on a clean tree.
 */
export async function pushWorkItemBranch(repoPath: string): Promise<void> {
  await withGitOperationStatus(repoPath, () => pushBranch(repoPath));
}

/**
 * A PR checkout pushes where its PR is (`pull-request-push.ts`): never with
 * the `--set-upstream origin HEAD` retry, which would publish a new branch the
 * PR never sees.
 */
async function pushBranch(repoPath: string): Promise<void> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['branch', '--show-current']);
  const branch = stdout.trim();
  const plan = branch ? await planPullRequestPush(ctx, branch) : ({ kind: 'default' } as const);
  if (plan.kind === 'refused') throw new Error(plan.message);
  if (plan.kind === 'explicit') {
    await execFileAsync(GIT_EXECUTABLE, ['push', plan.remote, plan.refspec], {
      cwd: repoPath,
      timeout: PUSH_TIMEOUT_MS,
    });
    return;
  }
  try {
    await execFileAsync(GIT_EXECUTABLE, ['push'], { cwd: repoPath, timeout: PUSH_TIMEOUT_MS });
  } catch {
    await execFileAsync(GIT_EXECUTABLE, ['push', '--set-upstream', 'origin', 'HEAD'], {
      cwd: repoPath,
      timeout: PUSH_TIMEOUT_MS,
    });
  }
}
