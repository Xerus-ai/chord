import { CheckCircle2, GitMerge, GitPullRequest, Loader2, XCircle } from 'lucide-react';
import { selectFocusedLane } from '@renderer/features/right-rail/band/lane-band-input';
import {
  computeReviewAggregate,
  useLaneChecks,
  useLaneReviews,
} from '@renderer/features/right-rail/checks-pr/pr-data';
import { useFocusedWorktreeId } from '@renderer/features/right-rail/use-focused-worktree';
import { statusTextClass } from '@renderer/lib/status-dot';
import { cn } from '@renderer/utils/utils';
import { useLanePullRequests } from './use-lane-pull-requests';

/**
 * The band's state, borrowed by the topbar while the rail is closed.
 *
 * Only the pull request's state travels — the focused lane's, read from the
 * same query keys and the same focus selector the rail uses (the owner's
 * layout is keyed by the work item). The band's other half — uncommitted
 * files, commits to push — is left to the rail, so a lane with no pull request
 * simply shows no chip and the toggle beside it is the whole affordance.
 */
export function ClosedRailStateChip({
  workItemId,
  onOpenRail,
}: {
  workItemId: string;
  onOpenRail: () => void;
}) {
  const worktreeId = useFocusedWorktreeId(workItemId, workItemId);
  const lanes = useLanePullRequests(workItemId);
  const checks = useLaneChecks(workItemId, worktreeId);
  const reviews = useLaneReviews(workItemId, worktreeId);

  const pr = selectFocusedLane(lanes.data, worktreeId)?.pr ?? null;
  if (!pr) return null;

  const checkRows = checks.data?.checks ?? [];
  const failing = checkRows.filter((check) => check.status === 'fail').length;
  const running = checkRows.filter((check) => check.status === 'pending').length;
  const reviewRows = reviews.data ?? [];
  const reviewState = reviewRows.length > 0 ? computeReviewAggregate(reviewRows).state : null;

  const { Icon, signal, text } = (() => {
    if (pr.status === 'merged')
      return { Icon: GitMerge, signal: 'merged' as const, text: 'Merged' };
    if (failing > 0) {
      return {
        Icon: XCircle,
        signal: 'danger' as const,
        text: `${failing} check${failing === 1 ? '' : 's'} failing`,
      };
    }
    if (reviewState === 'changes_requested') {
      return { Icon: XCircle, signal: 'warning' as const, text: 'Changes requested' };
    }
    if (running > 0) {
      return {
        Icon: Loader2,
        signal: 'running' as const,
        text: `${running} check${running === 1 ? '' : 's'} running`,
      };
    }
    if (reviewState === 'approved') {
      return { Icon: CheckCircle2, signal: 'success' as const, text: 'Approved' };
    }
    return { Icon: GitPullRequest, signal: 'neutral' as const, text: `#${pr.number}` };
  })();

  return (
    <button
      type="button"
      onClick={onOpenRail}
      title="Show right panel · Mod+L"
      className={cn(
        'flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-list-row font-medium transition-colors hover:bg-surface-hover',
        statusTextClass(signal)
      )}
    >
      <Icon className={cn('size-icon-sm', signal === 'running' && 'animate-spin')} />
      {text}
    </button>
  );
}
