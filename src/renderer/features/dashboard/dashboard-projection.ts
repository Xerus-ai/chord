import { pullRequestKey, type NeedsYouPullRequestRef } from '@shared/sidebar-summaries';
import { needsYouLabel } from '@renderer/features/app-sidebar/needs-you-label';
import { getStatusWord } from '@renderer/features/app-sidebar/row-presentation';
import type { SidebarItem } from '@renderer/features/app-sidebar/sidebar-projection';
import type { StatusSignal } from '@renderer/lib/status-dot';

export interface DashboardSections {
  needsYou: SidebarItem[];
  running: SidebarItem[];
  pickUp: SidebarItem[];
}

/**
 * Splits the user's active work so each item appears exactly once, in its
 * highest-priority home: waiting on the user, then an agent streaming a turn,
 * then everything else. Order within a section is the caller's (the sidebar's
 * urgency order), so the two lists never disagree about what comes first.
 *
 * "Running" is the `working` bucket, not `liveSessionCount`: a session held
 * open in memory with no turn streaming is not work happening.
 */
export function sectionDashboardItems(items: readonly SidebarItem[]): DashboardSections {
  const sections: DashboardSections = { needsYou: [], running: [], pickUp: [] };
  for (const item of items) {
    if (item.needsYou.length > 0 || item.bucket === 'needs_input') sections.needsYou.push(item);
    else if (item.bucket === 'working') sections.running.push(item);
    else sections.pickUp.push(item);
  }
  return sections;
}

/**
 * Review requests that need a row of their own: a request on one of the
 * user's own work items already surfaces as that card's reason (through
 * `mergePullRequestReasons`), so listing it again would be the same fact twice.
 */
export function selectReviewRequests(
  refs: readonly NeedsYouPullRequestRef[] | undefined,
  items: readonly SidebarItem[]
): NeedsYouPullRequestRef[] {
  if (!refs) return [];
  const ownKeys = new Set(
    items
      .map((item) => (item.pullRequestUrl ? pullRequestKey(item.pullRequestUrl) : null))
      .filter((key): key is string => key !== null)
  );
  return refs.filter((ref) => !ownKeys.has(ref.key));
}

export interface CardSignal {
  label: string;
  signal: StatusSignal;
}

/**
 * A card's one chip. What the user is asked for leads; a mention alone stays
 * neutral because it asks for attention, not for an unblock. Otherwise the
 * sidebar's own status word, so a state reads the same on both surfaces.
 */
export function chooseCardSignal(item: SidebarItem): CardSignal | null {
  const asked = needsYouLabel(item.needsYou);
  if (asked) {
    const mentionOnly = item.needsYou.every((reason) => reason.kind === 'mentioned');
    return { label: asked, signal: mentionOnly ? 'neutral' : 'warning' };
  }
  const status = getStatusWord(item);
  return status ? { label: status.word, signal: status.signal } : null;
}

export interface MergeCountRow {
  status: string;
  prNumber: number | null;
  updatedAt: number;
}

/**
 * Done items with a pull request whose row changed at or after `sinceSeconds`.
 * `updatedAt` stands in for the merge time — no merge timestamp is stored
 * locally, and marking an item done is the last write a merged item gets.
 */
export function countMergedSince(rows: readonly MergeCountRow[], sinceSeconds: number): number {
  return rows.filter(
    (row) => row.status === 'done' && row.prNumber !== null && row.updatedAt >= sinceSeconds
  ).length;
}

export interface StatSegment {
  count: number;
  label: string;
  signal: StatusSignal;
}

/** Null = not loaded. Both null and zero are omitted: the line never prints
 * a count it does not have, and "0 running" is noise. */
export interface StatCounts {
  active: number | null;
  needYou: number | null;
  running: number | null;
  mergedThisWeek: number | null;
}

export function buildStatSegments(counts: StatCounts): StatSegment[] {
  const segments: [number | null, string, StatusSignal][] = [
    [counts.active, 'active', 'neutral'],
    [counts.needYou, 'need you', 'warning'],
    [counts.running, 'running', 'running'],
    [counts.mergedThisWeek, 'merged this week', 'neutral'],
  ];
  return segments
    .filter((segment): segment is [number, string, StatusSignal] => (segment[0] ?? 0) > 0)
    .map(([count, label, signal]) => ({ count, label, signal }));
}

/** The branch a card names: the work item's own, else whatever the checkout
 * is on — an item worked straight in the repo has no branch_name but is
 * still on a branch. */
export function resolveCardBranch(item: SidebarItem, checkoutBranch: string | null): string | null {
  return item.branchName ?? checkoutBranch;
}

/** The agent a card names: the one whose session is in use, else the one
 * the item was created with (`work_items.agent_provider`). */
export function resolveCardProviderId(
  item: SidebarItem,
  createdWithProvider: string | null
): string | null {
  return item.providerId ?? createdWithProvider;
}
