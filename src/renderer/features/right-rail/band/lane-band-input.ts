import type { LanePr, LanePullRequest, WorkItemLanePullRequests } from '@shared/lane-pull-requests';

/**
 * The band's PR facts come from the focused lane — the lane the user has open
 * — never from the work item: a second lane's PR is its own, and the primary's
 * PR does not stop it opening one (plan 2026-09-26 P8).
 */

/** The focused lane, or null while the lanes load or for a lane not in the list. */
export function selectFocusedLane(
  lanes: WorkItemLanePullRequests | undefined,
  worktreeId: string | null
): LanePullRequest | null {
  if (!lanes || worktreeId === null) return null;
  return lanes.lanes.find((lane) => lane.worktreeId === worktreeId) ?? null;
}

/** The PR's own state, with draft treated as a state rather than a flag. */
export function toLanePrState(pr: LanePr | null): 'open' | 'merged' | 'closed' | 'draft' | null {
  if (!pr) return null;
  if (pr.isDraft) return 'draft';
  if (pr.status === 'merged' || pr.status === 'closed') return pr.status;
  return 'open';
}

/** GitHub would accept a merge of this PR now: open, out of draft, not conflicting. */
export function canMergeLanePr(pr: LanePr | null, repositoryUrl: string | null): boolean {
  return (
    !!pr &&
    repositoryUrl !== null &&
    pr.status === 'open' &&
    !pr.isDraft &&
    pr.mergeableStatus !== 'CONFLICTING'
  );
}
