import { CheckCircle, GitPullRequest } from 'lucide-react';
import type { PullRequestCardData } from './chat-types';
import { useLanePullRequests } from './use-lane-pull-requests';
import { useLanePrActions } from './use-pr-actions';

/**
 * The PR card the agent posts in chat. Its actions address the lane whose PR
 * the card names (matched by URL), through the same hook the band uses — a
 * merge started here and one started there are the same operation, pinned to
 * the same commit. Without a work item, or a lane holding that PR, there is
 * nothing to act on, so only the card's own link survives.
 */
export function PullRequestCard({
  data,
  workItemId,
}: {
  data: PullRequestCardData;
  workItemId?: string;
}) {
  const laneId = useCardLaneId(workItemId, data.url);
  const {
    canMerge,
    canRequestReview,
    merging,
    requestingReview,
    merge,
    requestReview,
    openPr,
    prUrl: syncedPrUrl,
    error,
  } = useLanePrActions(workItemId, laneId);
  const prUrl = syncedPrUrl ?? data.url ?? null;

  return (
    <div className="mt-3 flex max-w-[720px] flex-col rounded-md border border-border bg-surface-inset">
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <GitPullRequest className="h-[18px] w-[18px] shrink-0 text-status-ok" />
        <span className="min-w-0 flex-1 text-title font-semibold tracking-title text-text">
          {data.title}
        </span>
        <span className="shrink-0 text-body tracking-body tabular-nums text-text-passive">
          #{data.prNumber}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        <span
          className="rounded-xs bg-status-ok-bg px-2 py-1 font-mono text-micro tracking-micro font-semibold text-status-ok"
          style={{ fontVariantLigatures: 'none' }}
        >
          {data.branch}
        </span>
        <span className="text-tiny tracking-tiny text-text-passive">→ {data.targetBranch}</span>
        <span
          className="flex gap-1 font-mono text-tiny tracking-tiny font-medium tabular-nums"
          style={{ fontVariantLigatures: 'none' }}
        >
          <span className="text-diff-add">+{data.added}</span>
          <span className="text-diff-del">-{data.removed}</span>
        </span>
        {data.checksText && (
          <span className="flex items-center gap-1 text-tiny tracking-tiny text-status-ok">
            <CheckCircle className="h-[12px] w-[12px]" />
            {data.checksText}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-5 py-3">
        <div className="flex gap-2">
          <button
            onClick={() => void merge()}
            disabled={!canMerge || merging}
            title={canMerge ? undefined : 'This pull request cannot be merged right now'}
            className="cursor-pointer rounded-lg bg-action-bg px-3 py-1 text-tiny tracking-tiny font-bold text-action-fg transition-colors duration-100 hover:bg-action-bg-hover disabled:cursor-default disabled:bg-surface-hover-solid disabled:font-semibold disabled:text-text-passive"
          >
            {merging ? 'Merging…' : 'Merge PR'}
          </button>
          <button
            onClick={() => openPr(prUrl)}
            disabled={!prUrl}
            title={prUrl ?? 'No pull request URL yet'}
            className="cursor-pointer rounded-sm border border-border-strong bg-transparent px-3 py-1 text-tiny tracking-tiny font-semibold text-text-muted transition-colors duration-100 hover:bg-surface-hover-solid disabled:cursor-default disabled:text-text-passive disabled:hover:bg-transparent"
          >
            View on GitHub
          </button>
          {/* Only a draft has review to request — taking it out of draft is
              what notifies reviewers and code owners. */}
          {canRequestReview && (
            <button
              onClick={() => void requestReview()}
              disabled={requestingReview}
              title="Take this pull request out of draft and notify reviewers"
              className="cursor-pointer rounded-sm border border-border-strong bg-transparent px-3 py-1 text-tiny tracking-tiny font-semibold text-text-muted transition-colors duration-100 hover:bg-surface-hover-solid disabled:cursor-default disabled:text-text-passive disabled:hover:bg-transparent"
            >
              {requestingReview ? 'Requesting…' : 'Request Review'}
            </button>
          )}
        </div>
        {error && (
          <span role="alert" className="text-tiny tracking-tiny text-status-err">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/** The lane whose PR this card names, or null when no lane of the work item holds it. */
function useCardLaneId(workItemId: string | undefined, prUrl: string | undefined): string | null {
  const lanes = useLanePullRequests(workItemId);
  if (!prUrl) return null;
  return lanes.data?.lanes.find((lane) => lane.pr?.url === prUrl)?.worktreeId ?? null;
}
