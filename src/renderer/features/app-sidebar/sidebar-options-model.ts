/**
 * Pure state for the sidebar options popover.
 *
 * Every option in the design's options table is declared here, including the
 * ones nothing can answer yet. Those carry `unsupportedReason` and render
 * disabled with a tooltip rather than vanishing — a menu whose shape changes
 * with the data is a menu nobody learns. A reason is a code, not a sentence
 * the popover has to translate.
 */

export const SORT_BY_VALUES = ['attention', 'recent', 'name', 'created'] as const;
export type SortBy = (typeof SORT_BY_VALUES)[number];

export const REPO_ORDER_VALUES = ['recent', 'name', 'manual'] as const;
export type RepoOrder = (typeof REPO_ORDER_VALUES)[number];

export const ROW_LAYOUT_VALUES = ['compact', 'detailed'] as const;
export type RowLayout = (typeof ROW_LAYOUT_VALUES)[number];

export const AGENT_SESSION_MODES = ['off', 'live', 'full'] as const;
export type AgentSessionMode = (typeof AGENT_SESSION_MODES)[number];

export const ROW_PROPERTY_KEYS = [
  'diffStat',
  'pr',
  'ticket',
  'branch',
  'participants',
  'devServer',
  'artifactCount',
] as const;
export type RowPropertyKey = (typeof ROW_PROPERTY_KEYS)[number];

export const FILTER_KEYS = [
  'hideIdleOverSevenDays',
  'hideDone',
  'hideTeammates',
  'hideWithoutPullRequest',
  'hideArchivedWorktrees',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Why an option cannot be offered. Codes, never prose — the popover owns the copy. */
export type UnsupportedReason =
  | 'no_tickets_in_summaries'
  | 'no_participants_on_local_items'
  | 'no_artifact_count_in_summaries'
  | 'no_suspended_sessions_in_summaries'
  | 'no_archived_worktrees_in_summaries'
  | 'manual_repo_drag_not_built';

export interface SidebarOptions {
  /** Repo ids to show. Empty means every repo — the "All repos" default. */
  visibleRepoIds: string[];
  sortBy: SortBy;
  repoOrder: RepoOrder;
  rowLayout: RowLayout;
  properties: Record<RowPropertyKey, boolean>;
  agentSessions: AgentSessionMode;
  filters: Record<FilterKey, boolean>;
}

export const DEFAULT_SIDEBAR_OPTIONS: SidebarOptions = {
  visibleRepoIds: [],
  sortBy: 'attention',
  repoOrder: 'recent',
  rowLayout: 'compact',
  properties: {
    diffStat: true,
    pr: true,
    ticket: false,
    branch: false,
    participants: false,
    devServer: false,
    artifactCount: false,
  },
  agentSessions: 'live',
  filters: {
    hideIdleOverSevenDays: false,
    hideDone: false,
    hideTeammates: false,
    hideWithoutPullRequest: false,
    hideArchivedWorktrees: false,
  },
};

/** Options with no data behind them today. Absent key = fully supported. */
export const UNSUPPORTED_REPO_ORDER: Partial<Record<RepoOrder, UnsupportedReason>> = {
  manual: 'manual_repo_drag_not_built',
};

export const UNSUPPORTED_PROPERTIES: Partial<Record<RowPropertyKey, UnsupportedReason>> = {
  ticket: 'no_tickets_in_summaries',
  participants: 'no_participants_on_local_items',
  artifactCount: 'no_artifact_count_in_summaries',
};

export const UNSUPPORTED_AGENT_SESSIONS: Partial<Record<AgentSessionMode, UnsupportedReason>> = {
  full: 'no_suspended_sessions_in_summaries',
};

export const UNSUPPORTED_FILTERS: Partial<Record<FilterKey, UnsupportedReason>> = {
  hideArchivedWorktrees: 'no_archived_worktrees_in_summaries',
};

/**
 * How many options sit away from their default — the count badge on the
 * sliders icon, so a filtered sidebar never looks like an empty one.
 */
export function countActiveOptions(options: SidebarOptions): number {
  let count = 0;
  if (options.visibleRepoIds.length > 0) count += 1;
  if (options.sortBy !== DEFAULT_SIDEBAR_OPTIONS.sortBy) count += 1;
  if (options.repoOrder !== DEFAULT_SIDEBAR_OPTIONS.repoOrder) count += 1;
  if (options.rowLayout !== DEFAULT_SIDEBAR_OPTIONS.rowLayout) count += 1;
  if (options.agentSessions !== DEFAULT_SIDEBAR_OPTIONS.agentSessions) count += 1;
  for (const key of ROW_PROPERTY_KEYS) {
    if (options.properties[key] !== DEFAULT_SIDEBAR_OPTIONS.properties[key]) count += 1;
  }
  for (const key of FILTER_KEYS) {
    if (options.filters[key] !== DEFAULT_SIDEBAR_OPTIONS.filters[key]) count += 1;
  }
  return count;
}

/**
 * Rebuilds a persisted snapshot into a complete `SidebarOptions`. View state
 * outlives the shape that wrote it: an option added after a snapshot was
 * saved has no entry, and an unsupported value can be left behind by a build
 * that still offered it. Both resolve to the default rather than to
 * `undefined` leaking into a comparison.
 */
export function normalizeSidebarOptions(stored: unknown): SidebarOptions {
  if (!stored || typeof stored !== 'object') return DEFAULT_SIDEBAR_OPTIONS;
  const raw = stored as Partial<SidebarOptions>;

  const pick = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    unsupported: Partial<Record<T, UnsupportedReason>>,
    fallback: T
  ): T => {
    const candidate = value as T;
    if (!allowed.includes(candidate)) return fallback;
    return unsupported[candidate] ? fallback : candidate;
  };

  return {
    visibleRepoIds: Array.isArray(raw.visibleRepoIds)
      ? raw.visibleRepoIds.filter((id): id is string => typeof id === 'string')
      : [],
    sortBy: pick(raw.sortBy, SORT_BY_VALUES, {}, 'attention'),
    repoOrder: pick(raw.repoOrder, REPO_ORDER_VALUES, UNSUPPORTED_REPO_ORDER, 'recent'),
    rowLayout: pick(raw.rowLayout, ROW_LAYOUT_VALUES, {}, 'compact'),
    properties: Object.fromEntries(
      ROW_PROPERTY_KEYS.map((key) => [
        key,
        UNSUPPORTED_PROPERTIES[key]
          ? false
          : (raw.properties?.[key] ?? DEFAULT_SIDEBAR_OPTIONS.properties[key]),
      ])
    ) as Record<RowPropertyKey, boolean>,
    agentSessions: pick(raw.agentSessions, AGENT_SESSION_MODES, UNSUPPORTED_AGENT_SESSIONS, 'live'),
    filters: Object.fromEntries(
      FILTER_KEYS.map((key) => [
        key,
        UNSUPPORTED_FILTERS[key]
          ? false
          : (raw.filters?.[key] ?? DEFAULT_SIDEBAR_OPTIONS.filters[key]),
      ])
    ) as Record<FilterKey, boolean>,
  };
}
