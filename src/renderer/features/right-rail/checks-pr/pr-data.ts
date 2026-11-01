import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PullRequestCheck, PullRequestReview } from '@shared/pull-requests';
import { describeRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { rpc } from '@renderer/lib/ipc';

/**
 * CI and review reads for the Checks & PR panel. Moved here from
 * `work-list/right-panel-pr-data.ts` with the old right panel: the rail is the
 * only consumer, and a data module living next to a deleted view is how dead
 * fixtures survive a rewrite.
 */
export interface CheckEntry {
  name: string;
  status: 'pass' | 'fail' | 'pending';
  duration: string;
  conclusion: string | null;
  detailsUrl: string | null;
  workflowName: string | null;
  appName: string | null;
  appLogoUrl: string | null;
}

export function toCheckEntry(check: PullRequestCheck): CheckEntry {
  let duration = '';
  if (check.startedAt && check.completedAt) {
    const ms = new Date(check.completedAt).getTime() - new Date(check.startedAt).getTime();
    duration = ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
  }

  let status: CheckEntry['status'] = 'pending';
  if (check.status === 'COMPLETED') {
    status = check.conclusion === 'SUCCESS' ? 'pass' : 'fail';
  }

  return {
    name: check.name,
    status,
    duration,
    conclusion: check.conclusion ?? null,
    detailsUrl: check.detailsUrl ?? null,
    workflowName: check.workflowName ?? null,
    appName: check.appName ?? null,
    appLogoUrl: check.appLogoUrl ?? null,
  };
}

export interface ChecksResult {
  checks: CheckEntry[];
  mergeableStatus: string | null;
  mergeStateStatus: string | null;
}

/**
 * The checks on one lane's pull request — the focused lane's, in the rail.
 * Shared by the band, the panel and the activity-bar status dot: one cache
 * entry per lane. `worktreeId` null (the lanes are still loading) reads nothing.
 */
export function useLaneChecks(
  workItemId: string,
  worktreeId: string | null
): UseQueryResult<ChecksResult> {
  return useQuery({
    queryKey: ['workItem', 'checks', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.pullRequests.getChecksForWorkItem(workItemId, worktreeId!);
      if (!result.success) throw new Error(describeRpcFailure('Load checks', result.error));
      return {
        checks: result.data.checks.map(toCheckEntry),
        mergeableStatus: result.data.mergeableStatus,
        mergeStateStatus: result.data.mergeStateStatus,
      };
    },
    enabled: worktreeId !== null,
    refetchInterval: 5000,
  });
}

/** The reviews on one lane's pull request; `worktreeId` as for `useLaneChecks`. */
export function useLaneReviews(
  workItemId: string,
  worktreeId: string | null
): UseQueryResult<PullRequestReview[]> {
  return useQuery({
    queryKey: ['workItem', 'reviews', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.pullRequests.getReviewsForWorkItem(workItemId, worktreeId!);
      if (!result.success) throw new Error(describeRpcFailure('Load reviews', result.error));
      return result.data.reviews;
    },
    enabled: worktreeId !== null,
    refetchInterval: 5000,
  });
}

export type ReviewAggregateState = 'approved' | 'changes_requested' | 'pending';

/**
 * One verdict from many reviews: the latest review per reviewer decides, and
 * any outstanding "changes requested" outranks every approval.
 */
export function computeReviewAggregate(reviews: PullRequestReview[]): {
  state: ReviewAggregateState;
  label: string;
} {
  const latestByReviewer = new Map<string, PullRequestReview>();
  for (const review of reviews) {
    const existing = latestByReviewer.get(review.reviewerId);
    if (
      !existing ||
      (review.submittedAt && existing.submittedAt && review.submittedAt > existing.submittedAt)
    ) {
      latestByReviewer.set(review.reviewerId, review);
    }
  }

  const latest = Array.from(latestByReviewer.values());
  if (latest.some((review) => review.state === 'CHANGES_REQUESTED')) {
    return { state: 'changes_requested', label: 'Changes requested' };
  }
  if (latest.length > 0 && latest.every((review) => review.state === 'APPROVED')) {
    return { state: 'approved', label: 'Approved' };
  }
  return { state: 'pending', label: 'Review pending' };
}
