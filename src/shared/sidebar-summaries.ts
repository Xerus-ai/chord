import type { LaneCompareBase } from './git-settings';
import type { PullRequestState } from './pull-requests';
import type { WorkItemStatusBucket, WorktreeBucket } from './work-item-status';

/** A subagent seen in a live turn's stream, name only — see module doc in
 * `main/core/work-items/sidebar-worktree-summaries.ts` for why there is no
 * `lastActiveAt`: `SubagentItem` (src/shared/stream-items.ts) carries no
 * timestamp, so one would have to be invented. */
export interface SidebarSubagentSummary {
  name: string;
}

/** A session currently held in main-process memory for a worktree. */
export interface SidebarLiveSessionSummary {
  sessionId: string;
  /** `agent_sessions.kind` ('chat' or 'terminal'): with the title and the
   * provider, what `labelAgentSession` names the row by. */
  kind: string;
  title: string | null;
  /** Epoch seconds — `agent_sessions.last_active_at`. */
  lastActiveAt: number;
  /** This session's own `agent_sessions.agent_provider_id` — the logo the
   * session row wears. Null for a session with no provider (a terminal). */
  providerId: string | null;
  subagents: SidebarSubagentSummary[];
}

export interface SidebarDiffStats {
  added: number;
  removed: number;
}

/**
 * One lane's compare base as the sidebar reports it: the base its +/− counts
 * against, `no_upstream`, or `unreadable` — its checkout folder is gone or git
 * could not read it — with the reason, shown on that lane's row alone.
 */
export type WorktreeCompareState = LaneCompareBase | { kind: 'unreadable'; message: string };

export interface SidebarWorktreeSummary {
  id: string;
  branch: string | null;
  /** Where the lane's PR merges (`work_item_worktrees.target_ref`), e.g.
   * `origin/main`. Null on lanes from before targets were recorded. */
  targetRef: string | null;
  title: string | null;
  isPrimary: boolean;
  /** Null when `compareBase` is `no_upstream` or `unreadable`, or a diff could not be read. */
  diffStats: SidebarDiffStats | null;
  /** What `diffStats` counts committed work against (Settings › Git › Compare base), or why it can't. */
  compareBase: WorktreeCompareState;
  /** Provider of the worktree's newest session (by `created_at`), or null
   * when the worktree has never had one. */
  providerId: string | null;
  bucket: WorktreeBucket;
  liveSessions: SidebarLiveSessionSummary[];
}

/** Why a work item is waiting on the signed-in user. Main's summaries carry
 * the local reasons (pending requests, `mentioned`: teammates' chat messages
 * naming the user since they last opened the item). The review reasons never
 * come from summaries — the renderer merges them from
 * `rpc.github.getNeedsYouPullRequests` by `pr_url`, so an offline GitHub
 * search cannot take the summaries down with it. */
export type NeedsYouReason =
  | { kind: 'pending_permission'; count: number }
  | { kind: 'pending_plan'; count: number }
  | { kind: 'review_requested'; prUrl: string }
  | { kind: 'changes_requested'; prUrl: string }
  | { kind: 'mentioned'; count: number };

/** One PR waiting on the signed-in user: `key` is what a work item's
 * `pr_url` is matched on; the rest is what a review row prints for a PR that
 * is not one of the user's work items. */
export interface NeedsYouPullRequestRef {
  key: string;
  url: string;
  number: number;
  title: string;
  /** `owner/name`, as GitHub spells it. */
  repo: string;
  /** Null when the author's GitHub account no longer exists. */
  author: string | null;
}

/** Open PRs, any repo, waiting on the signed-in GitHub user. */
export interface NeedsYouPullRequests {
  reviewRequested: NeedsYouPullRequestRef[];
  changesRequested: NeedsYouPullRequestRef[];
}

const PR_URL = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i;

/**
 * `owner/repo#number`, lowercased — the identity a work item's stored
 * `pr_url` and a GitHub search result share even when one carries a trailing
 * slash, a `/files` suffix, or different casing. Null for a non-PR URL.
 */
export function pullRequestKey(url: string): string | null {
  const match = PR_URL.exec(url);
  if (!match) return null;
  return `${match[1]}/${match[2]}#${match[3]}`.toLowerCase();
}

/**
 * The `#123` a row prints, off the same URL parse as `pullRequestKey` — one
 * regex, so the number a row shows and the key the Needs You merge joins on
 * can never disagree. Null for a URL that is not a pull request.
 */
export function pullRequestNumber(url: string): number | null {
  const match = PR_URL.exec(url);
  return match ? Number(match[3]) : null;
}

/**
 * A work item's pull request, as facts rather than as a sentence: the row
 * picks its own glyph, tone and word from `state` and `checks`.
 * `state` is `derivePrState`; `checks` is `deriveChecksState` with its
 * "no checks on the head commit" case as null.
 */
export interface SidebarPullRequestSummary {
  url: string;
  number: number;
  state: PullRequestState;
  checks: 'passing' | 'failing' | 'pending' | null;
}

export interface SidebarSummary {
  id: string;
  diffStats: SidebarDiffStats | null;
  pullRequest: SidebarPullRequestSummary | null;
  sessionCount: number;
  aggregateBucket: WorkItemStatusBucket;
  worktrees: SidebarWorktreeSummary[];
  needsYou: NeedsYouReason[];
  /** First human chat message for the item, truncated to ~200 chars. Null
   * when the item has no human message yet. */
  description: string | null;
  devServerUrl: string | null;
  /** The branch the primary worktree's checkout is on, as git reports it —
   * set even when `work_items.branch_name` is null because the item works
   * straight in the repo. Null for a detached HEAD or an unreadable repo. */
  checkoutBranch: string | null;
  /** Epoch seconds of the newest persisted `agent_turn` message across every
   * session of the item, or null when none has finished yet. */
  lastFinishedTurnAt: number | null;
  /** The item's archived lanes, listed under it as "Archived (n)". */
  archivedLaneCount: number;
}

/** A GitHub search node as `needs-you-prs.ts` selects it. Every field is
 * optional because the search is `type: ISSUE`: a node that is not a
 * PullRequest matches none of the fragment. */
export interface PullRequestSearchNode {
  url?: string;
  number?: number;
  title?: string;
  repository?: { nameWithOwner: string };
  author?: { login: string } | null;
}

/** The ref a search node describes, or null for a node that is not a pull
 * request. */
export function toPullRequestRef(node: PullRequestSearchNode): NeedsYouPullRequestRef | null {
  if (!node.url || node.number === undefined || !node.title || !node.repository) return null;
  const key = pullRequestKey(node.url);
  if (!key) return null;
  return {
    key,
    url: node.url,
    number: node.number,
    title: node.title,
    repo: node.repository.nameWithOwner,
    author: node.author?.login ?? null,
  };
}
