import { readCheckoutRemotes } from '@main/core/pull-requests/checkout-remotes';
import { findPullRequestsForBranches } from '@main/core/pull-requests/pr-branch-match';
import type { WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { countCommitsAhead } from './lane-archive-git';
import { getPrimaryWorktreeRow } from './worktree-lookup';

/**
 * Whether Archive may also delete the lane's branch (plan §"Decisions for
 * Phase 5"): only when nothing is lost, which is when GitHub reports its PR
 * merged, the branch has nothing after the merged head, and nothing is
 * uncommitted. A PR head this clone does not have leaves "ahead" unknown,
 * so the branch stays.
 */
export function decideArchiveBranchDelete(args: {
  prStatus: string | null;
  aheadOfPrHead: number | null;
  uncommitted: number;
}): boolean {
  return args.prStatus === 'merged' && args.aheadOfPrHead === 0 && args.uncommitted === 0;
}

/** The lane's facts for `decideArchiveBranchDelete`, from the PR mirror and git. */
export async function canDeleteLaneBranch(
  lane: WorkItemWorktreeRow,
  uncommitted: number
): Promise<boolean> {
  if (lane.branchName === null || lane.isPrimary === 1) return false;
  const repoPath = getPrimaryWorktreeRow(lane.workItemId).path;
  const { repositoryUrl } = await readCheckoutRemotes(repoPath);
  const pr = repositoryUrl
    ? (await findPullRequestsForBranches(repositoryUrl, [lane.branchName])).get(lane.branchName)
    : undefined;
  const aheadOfPrHead = pr
    ? await countCommitsAhead(repoPath, pr.headRefOid, lane.branchName)
    : null;
  return decideArchiveBranchDelete({ prStatus: pr?.status ?? null, aheadOfPrHead, uncommitted });
}
