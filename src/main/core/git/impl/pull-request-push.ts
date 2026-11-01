import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Where a push of a PR checkout must go (`pull-request-checkout.ts` writes
 * the config read here):
 *   - `refused`: gh's config for a PR whose fork doesn't accept maintainer
 *     pushes, or was deleted — `branch.<b>.merge = refs/pull/<n>/head`. There
 *     is no branch anywhere a push could reach the PR through.
 *   - `explicit`: a fork PR checked out under another local name
 *     (`alice/main` tracking `alice/main` on remote `alice` → `main`). A plain
 *     `git push` refuses the name mismatch, and the usual
 *     `--set-upstream <remote> <branch>` retry would publish a new branch.
 *   - `default`: anything else pushes as it always has.
 */
export type PullRequestPushPlan =
  | { kind: 'default' }
  | { kind: 'refused'; message: string }
  | { kind: 'explicit'; remote: string; refspec: string };

export const FORK_PUSH_REFUSED_MESSAGE =
  "This branch is a pull request from a fork that doesn't accept maintainer pushes (or the fork was deleted), so there is nowhere to push it. Your commits stay in this lane; ask the author to allow edits by maintainers to push them to the PR.";

/** Git config value, or null when the key is unset (`git config` exits 1). */
export async function readGitConfig(ctx: IExecutionContext, key: string): Promise<string | null> {
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['config', '--get', key]);
    return stdout.trim() || null;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}

export async function planPullRequestPush(
  ctx: IExecutionContext,
  branch: string
): Promise<PullRequestPushPlan> {
  const merge = await readGitConfig(ctx, `branch.${branch}.merge`);
  if (merge?.startsWith('refs/pull/')) {
    return { kind: 'refused', message: FORK_PUSH_REFUSED_MESSAGE };
  }
  const pullRequest = await readGitConfig(ctx, `branch.${branch}.chordPullRequest`);
  const remote = await readGitConfig(ctx, `branch.${branch}.remote`);
  if (!pullRequest || !remote || !merge?.startsWith('refs/heads/')) return { kind: 'default' };
  if (merge === `refs/heads/${branch}`) return { kind: 'default' };
  return { kind: 'explicit', remote, refspec: `HEAD:${merge}` };
}
