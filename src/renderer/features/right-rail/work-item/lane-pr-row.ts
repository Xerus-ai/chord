import type { LanePr } from '@shared/lane-pull-requests';
import { derivePrBadge, derivePrState } from '@shared/pr-status-badge';
import type { PullRequestState } from '@shared/pull-requests';
import type { StatusSignal } from '@renderer/lib/status-dot';
import type { WorktreePullRequest } from './worktree-group';

const STATE_SIGNAL: Record<PullRequestState, StatusSignal> = {
  merged: 'merged',
  closed: 'danger',
  draft: 'neutral',
  conflicts: 'danger',
  changes_requested: 'warning',
  ready_to_merge: 'success',
  in_review: 'success',
};

/**
 * A lane's PR as its row in the Work item panel shows it: the same badge word
 * the sidebar derives ("In review", "Ready to merge", "Conflicts", …), from
 * the one ladder in `shared/pr-status-badge.ts`. Null for a lane without a PR.
 */
export function toLanePrRow(pr: LanePr | null): WorktreePullRequest | null {
  if (!pr) return null;
  return {
    number: pr.number,
    title: pr.title,
    state: derivePrBadge(pr),
    signal: STATE_SIGNAL[derivePrState(pr)],
  };
}
