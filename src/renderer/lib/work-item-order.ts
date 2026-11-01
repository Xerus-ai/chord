import type { PullRequestState } from '@shared/pull-requests';
import type { WorkItemRow } from '@main/db/schema-work-items';

/**
 * Ordering rules for work-item lists.
 *
 * The sidebar and the dashboard render the same work items side by side —
 * `AppSidebar` is a sibling of the workspace, not part of it, so both lists are
 * on screen at once. They disagreed: the sidebar sorted by urgency while the
 * dashboard showed whatever order `workItems.getAll()` returned (creation date,
 * newest first). One definition of "what matters most" now serves both.
 *
 * Type-only import of the row, so this stays a pure module with no Electron
 * import chain and can be tested directly.
 */

/** The live signals that make a row urgent. Both come from the summaries query. */
export interface WorkItemUrgencySignals {
  /** The pull request's derived state, not the word a badge prints — ordering
   * branches on the state so a copy change can never silently resort a list. */
  pullRequestState: PullRequestState | null;
  isRunning: boolean;
}

/** Nothing is known about a row until its summary lands. */
export const NO_URGENCY_SIGNALS: WorkItemUrgencySignals = {
  pullRequestState: null,
  isRunning: false,
};

/**
 * Higher sorts first. A running agent outranks everything — it is the one state
 * that is changing while you look at it. Blocked work (review comments to
 * answer, a conflict to resolve) outranks work that is merely waiting on
 * someone else.
 */
export function urgencyScore({ pullRequestState, isRunning }: WorkItemUrgencySignals): number {
  if (isRunning) return 3;
  if (pullRequestState === 'changes_requested' || pullRequestState === 'conflicts') return 2;
  if (pullRequestState === 'ready_to_merge' || pullRequestState === 'in_review') return 1;
  return 0;
}

/**
 * Urgency first, then most recently touched. The tiebreak is what makes this
 * degrade gracefully: before the summaries land every row scores 0 and the list
 * is ordered by recency rather than jumping around as badges arrive.
 */
export function sortByUrgency(
  items: WorkItemRow[],
  getSignals: (item: WorkItemRow) => WorkItemUrgencySignals
): WorkItemRow[] {
  return [...items].sort((a, b) => {
    const byUrgency = urgencyScore(getSignals(b)) - urgencyScore(getSignals(a));
    if (byUrgency !== 0) return byUrgency;
    return b.updatedAt - a.updatedAt;
  });
}

/**
 * Most recently touched first — the order "Recently completed" claims to be in.
 * Done items carry no urgency: nothing is running and no badge is actionable.
 */
export function sortByRecentlyUpdated(items: WorkItemRow[]): WorkItemRow[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}
