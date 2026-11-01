import type {
  NeedsYouReason,
  SidebarDiffStats,
  SidebarPullRequestSummary,
  WorktreeCompareState,
} from '@shared/sidebar-summaries';
import {
  compareWorkItemStatusBuckets,
  WORK_ITEM_STATUS_BUCKETS,
  type WorkItemStatusBucket,
} from '@shared/work-item-status';
import type { SidebarOptions } from './sidebar-options-model';

/**
 * The sidebar's own view of a work item — one shape for a local row and a
 * teammate's row alike, so the projection never branches on where the item
 * came from. `use-sidebar-items.ts` builds these; everything below is pure.
 */
export interface SidebarItem {
  id: string;
  name: string;
  repoId: string;
  repoLabel: string;
  branchName: string | null;
  bucket: WorkItemStatusBucket;
  /** Epoch seconds. */
  updatedAt: number;
  createdAt: number;
  ownership: 'mine' | 'team';
  /** A teammate's row wears its owner's avatar; the user's own rows have none. */
  owner: { name: string; avatarUrl: string | null } | null;
  /**
   * An item reached only through artifacts shared alone (shared-items step 3,
   * decision 4): the row stands for those artifacts and opens them, never the
   * work item. Null for every other row.
   */
  sharedArtifacts: readonly { id: string; name: string }[] | null;
  diffStats: SidebarDiffStats | null;
  pullRequestUrl: string | null;
  /** The PR's derived facts, when this machine has synced the PR row. A
   * teammate's item carries whatever the cloud item really has, which today
   * is a URL and nothing else — never a state invented from it. */
  pullRequest: SidebarPullRequestSummary | null;
  /** The agent whose logo the row wears in Status view: the provider of the
   * most recently active live session, else the primary worktree's. */
  providerId: string | null;
  devServerUrl: string | null;
  worktreeCount: number;
  liveSessionCount: number;
  needsYou: NeedsYouReason[];
  unread: boolean;
  /** 'provisioning' | 'failed' | 'ready' — a provisioning row cannot be acted on. */
  provisionStatus: string | null;
  /** A local row another account owns (schema-work-items.ts owner_account_id): not synced. */
  ownedByAnotherAccount: boolean;
  /**
   * What sets this row's repo group apart when another group has the same
   * name (shared-items step 4, decision 2): a teammate's item that matched no
   * local repo carries its origin's `owner/repo`, or `origin unknown`. Null
   * for the user's own repos and for shared items that joined one of them.
   */
  repoHint: string | null;
  /**
   * Why a single-lane item has no +/−: its one lane has no upstream to count
   * against, or its checkout could not be read (`resolveItemCompareCue`). The
   * row says so where the count would be. Null when the item counts, has more
   * than one lane (each lane's sub-row says which), or is a teammate's.
   */
  compareCue: ItemCompareCue | null;
}

/** A lane state that carries no +/−, as `SidebarWorktreeSummary.compareBase` reports it. */
export type ItemCompareCue = Exclude<WorktreeCompareState, { kind: 'ref' }>;

export const SIDEBAR_VIEW_VALUES = ['repo', 'status'] as const;

/**
 * Which of the two lists the user is looking at. Per-user view state, not an
 * option: the tab in the heading row is the whole control, and the same work
 * items appear under both — only the grouping differs.
 */
export type SidebarView = (typeof SIDEBAR_VIEW_VALUES)[number];

export function normalizeSidebarView(stored: unknown): SidebarView {
  return SIDEBAR_VIEW_VALUES.includes(stored as SidebarView) ? (stored as SidebarView) : 'repo';
}

export interface SidebarGroup {
  /** Which kind of header this group wears — never inferred from options. */
  kind: SidebarView;
  /** A repo id under 'repo', a status bucket under 'status'. */
  key: string;
  label: string;
  /** Why the label carries a hint, when the hint alone does not say. */
  tooltip: string | null;
  items: SidebarItem[];
}

export interface SidebarProjection {
  pinned: SidebarItem[];
  groups: SidebarGroup[];
}

/** Band headings, title case — the group header is a label, not a meta fact. */
const STATUS_BAND_LABEL: Record<WorkItemStatusBucket, string> = {
  needs_input: 'Needs input',
  failed: 'Failed',
  ready_to_review: 'Ready to review',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
};

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/**
 * The band a work item falls into under Status. A per-user signal — a pending
 * request, a review, a mention, already merged into `needsYou` by the caller —
 * lifts the item into Needs input, which is how it stays visible now that the
 * Needs You strip is gone. Failed and done outrank that: neither is something
 * the user can answer.
 */
function bandForItem(item: SidebarItem): WorkItemStatusBucket {
  if (item.bucket === 'failed' || item.bucket === 'done') return item.bucket;
  return item.needsYou.length > 0 ? 'needs_input' : item.bucket;
}

function compareByOption(a: SidebarItem, b: SidebarItem, sortBy: SidebarOptions['sortBy']): number {
  switch (sortBy) {
    case 'attention': {
      const byBucket = compareWorkItemStatusBuckets(a.bucket, b.bucket);
      return byBucket !== 0 ? byBucket : b.updatedAt - a.updatedAt;
    }
    case 'recent':
      return b.updatedAt - a.updatedAt;
    case 'name':
      return a.name.localeCompare(b.name);
    case 'created':
      return b.createdAt - a.createdAt;
  }
}

function compareByRecency(a: SidebarItem, b: SidebarItem): number {
  return b.updatedAt - a.updatedAt;
}

function passesFilters(item: SidebarItem, options: SidebarOptions, nowSeconds: number): boolean {
  const { filters } = options;
  if (options.visibleRepoIds.length > 0 && !options.visibleRepoIds.includes(item.repoId)) {
    return false;
  }
  if (filters.hideTeammates && item.ownership === 'team') return false;
  if (filters.hideDone && item.bucket === 'done') return false;
  if (filters.hideWithoutPullRequest && !item.pullRequestUrl) return false;
  if (
    filters.hideIdleOverSevenDays &&
    item.bucket === 'idle' &&
    nowSeconds - item.updatedAt > SEVEN_DAYS_SECONDS
  ) {
    return false;
  }
  return true;
}

/**
 * One group per repo, ordered by `repoOrder`. Done work stays in the repo it
 * belongs to — there is no Done section in this view — but sinks to the bottom
 * of its group whatever the sort, so finished rows never split live ones.
 */
function buildRepoGroups(items: readonly SidebarItem[], options: SidebarOptions): SidebarGroup[] {
  const groups = new Map<string, SidebarGroup>();
  for (const item of items) {
    const existing = groups.get(item.repoId);
    if (existing) existing.items.push(item);
    else
      groups.set(item.repoId, {
        kind: 'repo',
        key: item.repoId,
        label: item.repoLabel,
        tooltip: null,
        items: [item],
      });
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      if ((a.bucket === 'done') !== (b.bucket === 'done')) return a.bucket === 'done' ? 1 : -1;
      return compareByOption(a, b, options.sortBy);
    });
  }

  const ordered = disambiguateRepoLabels([...groups.values()]);
  if (options.repoOrder === 'name') {
    return ordered.sort((a, b) => a.label.localeCompare(b.label));
  }
  // 'recent': the repo holding the most recently touched work item leads.
  return ordered.sort(
    (a, b) =>
      Math.max(...b.items.map((i) => i.updatedAt)) - Math.max(...a.items.map((i) => i.updatedAt))
  );
}

export const ORIGIN_UNKNOWN_HINT = 'origin unknown';

const ORIGIN_UNKNOWN_TOOLTIP =
  "The owner's copy never reported its origin. It joins your group once it does.";

/**
 * Two repo groups with one name (a teammate's repo that matched none of the
 * user's, beside the user's own of that name, or two teammates' repos) read
 * as duplicates. Only then does a group with a hint wear it; a label no other
 * group has stays bare.
 */
function disambiguateRepoLabels(groups: SidebarGroup[]): SidebarGroup[] {
  const countByLabel = new Map<string, number>();
  for (const group of groups) {
    countByLabel.set(group.label, (countByLabel.get(group.label) ?? 0) + 1);
  }
  return groups.map((group) => {
    const hint = group.items[0].repoHint;
    if (hint === null || (countByLabel.get(group.label) ?? 0) < 2) return group;
    return {
      ...group,
      label: `${group.label} · ${hint}`,
      tooltip: hint === ORIGIN_UNKNOWN_HINT ? ORIGIN_UNKNOWN_TOOLTIP : null,
    };
  });
}

/**
 * One group per status band, in the fixed bucket order — the point of the view
 * is that the urgent band is always on top, so an empty band is omitted rather
 * than reordered. Done reads newest-first regardless of the sort: it is a log.
 */
function buildStatusGroups(items: readonly SidebarItem[], options: SidebarOptions): SidebarGroup[] {
  const groups = new Map<WorkItemStatusBucket, SidebarGroup>();
  for (const item of items) {
    const band = bandForItem(item);
    const existing = groups.get(band);
    if (existing) existing.items.push(item);
    else {
      groups.set(band, {
        kind: 'status',
        key: band,
        label: STATUS_BAND_LABEL[band],
        tooltip: null,
        items: [item],
      });
    }
  }

  for (const [band, group] of groups) {
    group.items.sort(
      band === 'done' ? compareByRecency : (a, b) => compareByOption(a, b, options.sortBy)
    );
  }

  return WORK_ITEM_STATUS_BUCKETS.map((band) => groups.get(band)).filter(
    (group): group is SidebarGroup => group !== undefined
  );
}

export interface ProjectSidebarArgs {
  items: readonly SidebarItem[];
  /** Per-user, in the user's own drag order. Ids no longer present are ignored. */
  pinnedIds: readonly string[];
  options: SidebarOptions;
  view: SidebarView;
  /** Epoch seconds; passed in so the projection stays pure. */
  nowSeconds: number;
}

/**
 * Lays every visible work item out once, in one list: pinned rows at the top
 * in the user's order, then one run of groups — by repo or by status band,
 * whichever view the user is in. Mine and a teammate's work share a group;
 * the row already says whose it is. Pinning is the one move: a pinned item
 * leaves its group entirely rather than appearing in two places.
 */
export function projectSidebar({
  items,
  pinnedIds,
  options,
  view,
  nowSeconds,
}: ProjectSidebarArgs): SidebarProjection {
  const visible = items.filter((item) => passesFilters(item, options, nowSeconds));
  const byId = new Map(visible.map((item) => [item.id, item]));

  const pinned = pinnedIds
    .map((id) => byId.get(id))
    .filter((item): item is SidebarItem => item !== undefined);
  const pinnedIdSet = new Set(pinned.map((item) => item.id));

  const grouped = visible.filter((item) => !pinnedIdSet.has(item.id));

  return {
    pinned,
    groups:
      view === 'repo' ? buildRepoGroups(grouped, options) : buildStatusGroups(grouped, options),
  };
}
