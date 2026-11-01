import type { Octokit } from '@octokit/rest';
import { eq } from 'drizzle-orm';
import type { RemoteBranchRef } from '@shared/create-from';
import { selectPreferredRemote } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type {
  PullRequestCheckout,
  PullRequestCheckoutError,
  PullRequestHeadError,
  PullRequestRef,
} from '@shared/work-item-ticket';
import { planTrackingBranch } from '@main/core/create-from/plan-tracking-branch';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { getGitHubPullRequestHead } from '@main/core/github/github-pull-request-head';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import {
  findRepositoryRemote,
  planPullRequestBranch,
} from '@main/core/work-items/pull-request-checkout';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';

export type ResolvePullRequestCheckoutError =
  | PullRequestHeadError
  | PullRequestCheckoutError
  | { type: 'no_repo'; message: string }
  | { type: 'repository_not_a_remote'; message: string };

/** Refs can't contain a NUL, so it separates the two fields safely. */
const REF_FORMAT = '--format=%(refname:strip=2)%00%(upstream)';

/**
 * A same-repository PR's branch lives on the remote that is the PR's
 * repository. When that isn't the preferred remote — the one the create
 * preflight asks for an unknown branch — the branch is checked out tracking
 * it, named as Create from… names that remote's branches
 * (`create-from/plan-tracking-branch.ts`).
 */
async function planSameRepositoryBranch(
  repoPath: string,
  remote: string,
  headRef: string
): Promise<{ branch: string; tracking?: RemoteBranchRef }> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  const run = async (args: string[]) => (await ctx.exec(GIT_EXECUTABLE, args)).stdout.trim();
  const remotes = (await run(['remote'])).split('\n').filter(Boolean);
  const preferred = selectPreferredRemote(
    undefined,
    remotes.map((name) => ({ name, url: '' }))
  ).name;
  if (remote === preferred) return { branch: headRef };

  const qualified = `${remote}/${headRef}`;
  const locals = (
    await run(['for-each-ref', REF_FORMAT, `refs/heads/${headRef}`, `refs/heads/${qualified}`])
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, upstream] = line.split('\0');
      return { name, upstream: upstream || null };
    });
  const preferredRemoteHasBranch = await run([
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/${preferred}/${headRef}`,
  ]).then(
    () => true,
    () => false
  );
  const plan = planTrackingBranch({
    remote,
    branch: headRef,
    isPreferredRemote: false,
    preferredRemoteHasBranch,
    locals,
  });
  return { branch: plan.localBranch, tracking: { remote, branch: headRef } };
}

/**
 * What a pasted PR URL or a Create from… PR pick checks out in the selected
 * repository, for the create dialog to show before Create: a
 * same-repository PR's own head branch, or the local branch a fork PR is
 * fetched into (`planPullRequestBranch`) — each from the remote that is the
 * PR's repository. A PR whose repository is none of the clone's remotes has
 * nothing to check out from, and is refused here, before GitHub is asked,
 * rather than at Create.
 */
export async function resolvePullRequestCheckout(
  args: PullRequestRef & { repoId: string | null },
  readOctokit: () => Promise<Octokit | null>
): Promise<Result<PullRequestCheckout, ResolvePullRequestCheckoutError>> {
  if (!args.repoId) {
    return err({ type: 'no_repo', message: 'Choose the repository to check the PR out in.' });
  }
  const [repo] = await db.select().from(repos).where(eq(repos.id, args.repoId)).limit(1);
  if (!repo) return err({ type: 'no_repo', message: `Repository ${args.repoId} was not found.` });

  const baseRemote = await findRepositoryRemote(repo.path, args);
  if (!baseRemote) {
    return err({
      type: 'repository_not_a_remote',
      message: `${args.owner}/${args.repo} isn't a remote of this repository. Add it as a remote, or choose a repository that has it.`,
    });
  }

  const head = await getGitHubPullRequestHead(await readOctokit(), args);
  if (!head.success) return head;

  if (!head.data.crossRepository) {
    const planned = await planSameRepositoryBranch(repo.path, baseRemote, head.data.headRef);
    return ok({ ...head.data, baseRemote, ...planned });
  }

  const planned = await planPullRequestBranch({
    repoPath: repo.path,
    pullRequest: {
      number: head.data.number,
      headRef: head.data.headRef,
      headOwner: head.data.headOwner,
      headCloneUrl: head.data.headCloneUrl,
      maintainerCanModify: head.data.maintainerCanModify,
      baseRemote,
    },
  });
  if (!planned.success) return planned;
  return ok({ ...head.data, branch: planned.data.branchName, baseRemote });
}
