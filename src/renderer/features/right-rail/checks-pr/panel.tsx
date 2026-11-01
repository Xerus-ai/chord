import { Send } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import type { PullRequestReview } from '@shared/pull-requests';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { useLanePrActions } from '@renderer/features/work-list/use-pr-actions';
import { rpc } from '@renderer/lib/ipc';
import { useAgentHandoff } from '../handoff';
import { useRailScope } from '../rail-context';
import { PanelShell, RailEmpty, RailError } from '../rail-primitives';
import { ChecksList } from './checks-list';
import { useLaneChecks, useLaneReviews, type CheckEntry } from './pr-data';
import { ReviewList } from './review-list';

function describeReviews(reviews: PullRequestReview[]): string {
  return reviews
    .map((review) => {
      const comments = review.comments
        .map(
          (comment) =>
            `  - ${comment.authorLogin} on ${comment.path ?? 'the pull request'}${comment.line != null ? `:${comment.line}` : ''}: ${comment.body}`
        )
        .join('\n');
      return `${review.reviewerLogin} (${review.state})${review.body ? `: ${review.body}` : ''}${comments ? `\n${comments}` : ''}`;
    })
    .join('\n\n');
}

/**
 * The focused lane's pull request: its CI checks and reviews. Each lane has
 * its own PR, so switching lanes switches what this panel shows.
 *
 * Its state, its number and the Merge button are not here: the band above
 * carries all three for every tab, and this panel repeating them was the
 * duplication the redesign removes. What stays is the detail — which check
 * failed, who asked for what — plus the one action the band's ladder has no
 * rung for, taking the pull request out of draft.
 *
 * Labels and assignees are not here: no bridged RPC returns them for a single
 * lane's PR (`getLanePullRequests` carries state, not the full row).
 */
export function ChecksPrPanel({ workItem }: { workItem: WorkItemRow }) {
  const { worktreeId } = useRailScope();
  const { pr, canRequestReview, requestingReview, requestReview, error } = useLanePrActions(
    workItem.id,
    worktreeId
  );

  const checksQuery = useLaneChecks(workItem.id, worktreeId);
  const reviewsQuery = useLaneReviews(workItem.id, worktreeId);
  const { handoff, error: handoffError } = useAgentHandoff({ workItemId: workItem.id });

  const prNumber = pr?.number ?? null;
  const prUrl = pr?.url ?? null;

  // The panel stays mounted, so this runs once per lane PR rather than on
  // every switch back to the panel.
  useEffect(() => {
    if (!prUrl || worktreeId === null) return;
    void rpc.pullRequests.syncChecksForWorkItem(workItem.id, worktreeId);
    void rpc.pullRequests.syncReviewsForWorkItem(workItem.id, worktreeId);
  }, [workItem.id, worktreeId, prUrl]);

  const fixChecksWithAi = useCallback(
    (checks: CheckEntry[]) => {
      const detail = checks
        .map(
          (check) =>
            `- ${check.name}${check.workflowName ? ` (${check.workflowName})` : ''}: ${check.conclusion ?? check.status}${check.detailsUrl ? `\n  ${check.detailsUrl}` : ''}`
        )
        .join('\n');
      void handoff({
        subject: `Failing check${checks.length === 1 ? '' : 's'} on #${prNumber}`,
        detail,
        instruction:
          'Find why each of these is failing, fix it in this worktree, and say what you changed.',
      });
    },
    [handoff, prNumber]
  );

  const addReviewsToChat = useCallback(
    (reviews: PullRequestReview[]) => {
      void handoff({
        subject: `Review feedback on #${prNumber}`,
        detail: describeReviews(reviews),
      });
    },
    [handoff, prNumber]
  );

  const fixReviewsWithAi = useCallback(
    (reviews: PullRequestReview[]) => {
      void handoff({
        subject: `Requested changes on #${prNumber}`,
        detail: describeReviews(reviews),
        instruction: 'Address each point in this worktree, then summarise what you changed.',
      });
    },
    [handoff, prNumber]
  );

  if (prNumber === null) {
    return (
      <PanelShell title="Checks">
        <RailEmpty>No pull request yet</RailEmpty>
      </PanelShell>
    );
  }

  return (
    <PanelShell title="Checks">
      {canRequestReview && (
        <div className="flex shrink-0 items-center border-b border-border-subtle px-3 py-2">
          <button
            type="button"
            onClick={() => void requestReview()}
            disabled={requestingReview}
            title="Take this pull request out of draft and notify reviewers"
            className="flex cursor-pointer items-center gap-1 rounded-xs border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-inset disabled:cursor-default"
          >
            <Send className="size-icon-xs" />
            {requestingReview ? 'Marking ready…' : 'Mark ready'}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {error && <RailError message={error} />}
        {handoffError && <RailError message={handoffError} />}
        {checksQuery.error instanceof Error && <RailError message={checksQuery.error.message} />}
        <ChecksList checks={checksQuery.data?.checks ?? []} onFixWithAi={fixChecksWithAi} />
        {reviewsQuery.error instanceof Error && <RailError message={reviewsQuery.error.message} />}
        <ReviewList
          reviews={reviewsQuery.data ?? []}
          onAddToChat={addReviewsToChat}
          onFixWithAi={fixReviewsWithAi}
        />
      </div>
    </PanelShell>
  );
}
