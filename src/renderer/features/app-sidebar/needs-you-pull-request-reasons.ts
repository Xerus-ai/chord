import {
  pullRequestKey,
  type NeedsYouPullRequests,
  type NeedsYouReason,
} from '@shared/sidebar-summaries';

/**
 * A row's full Needs You list: the reasons main's summary already carries,
 * plus review-requested / changes-requested when the row's `pr_url` is one
 * of the PRs GitHub reports as waiting on the user. With no PR data (GitHub
 * not reachable yet, or the fetch failed) only the review reasons are absent.
 */
export function mergePullRequestReasons(
  reasons: readonly NeedsYouReason[],
  prUrl: string | null,
  pullRequests: NeedsYouPullRequests | undefined
): NeedsYouReason[] {
  const key = prUrl ? pullRequestKey(prUrl) : null;
  if (!prUrl || !key || !pullRequests) return [...reasons];

  const review: NeedsYouReason[] = [];
  if (pullRequests.reviewRequested.some((ref) => ref.key === key)) {
    review.push({ kind: 'review_requested', prUrl });
  }
  if (pullRequests.changesRequested.some((ref) => ref.key === key)) {
    review.push({ kind: 'changes_requested', prUrl });
  }
  // Ahead of mentions, behind a blocked agent — the order `needsYouLabel` leads with.
  const firstMention = reasons.findIndex((r) => r.kind === 'mentioned');
  const at = firstMention === -1 ? reasons.length : firstMention;
  return [...reasons.slice(0, at), ...review, ...reasons.slice(at)];
}
