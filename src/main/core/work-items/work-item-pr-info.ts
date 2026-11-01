import { readCheckoutRemotes } from '@main/core/pull-requests/checkout-remotes';
import { findPullRequestsForBranches } from '@main/core/pull-requests/pr-branch-match';

/**
 * The pull request for the branch checked out in a worktree — any lane, the
 * primary included: a PR belongs to its lane, matched by head branch in the
 * checkout's GitHub repository (`pr-branch-match.ts`). No branch (detached
 * HEAD), no GitHub remote, or no synced PR all mean "no PR".
 */
export async function readPrInfoForBranch(checkoutPath: string, branch: string | null) {
  if (branch === null) return null;
  const { repositoryUrl } = await readCheckoutRemotes(checkoutPath);
  if (!repositoryUrl) return null;
  const pr = (await findPullRequestsForBranches(repositoryUrl, [branch])).get(branch);
  if (!pr) return null;
  return {
    title: pr.title,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    status: pr.status,
    additions: pr.additions,
    deletions: pr.deletions,
  };
}
