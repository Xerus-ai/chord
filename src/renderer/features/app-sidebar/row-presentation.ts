/**
 * Everything a sidebar row decides before it renders anything: which git
 * glyph it wears, the one coloured word on its second line, what sits in its
 * trailing slot, and whether its card has anything to open into.
 *
 * Pure and React-free on purpose — these are the rules the design argues
 * about, and they are cheaper to argue about in a test than in a screenshot.
 * Colour never appears here as a class: every branch returns a `StatusSignal`
 * from `lib/status-dot.ts`, which stays the single signal → colour mapping.
 */
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { SidebarLiveSessionSummary, SidebarSummary } from '@shared/sidebar-summaries';
import type { GitGlyph } from '@renderer/lib/components/git-glyph';
import {
  getStatusWord as getBucketWord,
  statusSignalForBucket,
  type StatusSignal,
} from '@renderer/lib/status-dot';
import type { ItemCompareCue, SidebarItem } from './sidebar-projection';

export interface GitGlyphPresentation {
  glyph: GitGlyph;
  signal: StatusSignal;
}

const GLYPH_BY_PR_STATE: Record<string, GitGlyphPresentation> = {
  merged: { glyph: 'merged', signal: 'merged' },
  closed: { glyph: 'closed', signal: 'danger' },
  conflicts: { glyph: 'conflict', signal: 'warning' },
  draft: { glyph: 'draft', signal: 'neutral' },
};

const OPEN_PULL_REQUEST: GitGlyphPresentation = { glyph: 'pull_request', signal: 'success' };
const PLAIN_BRANCH: GitGlyphPresentation = { glyph: 'branch', signal: 'neutral' };

/** No pull request is a branch, not an absence: work exists before a PR does. */
export function getGitGlyph(item: SidebarItem): GitGlyphPresentation {
  if (!item.pullRequest) return PLAIN_BRANCH;
  return GLYPH_BY_PR_STATE[item.pullRequest.state] ?? OPEN_PULL_REQUEST;
}

export interface StatusWord {
  word: string;
  signal: StatusSignal;
}

/**
 * Sentence case for a status word — the one transform between
 * `status-dot.ts`'s lower-case vocabulary (shared with dot-joined meta lines)
 * and a surface that wants it as a sentence: a row's status word and, per the
 * one-vocabulary decision, a Status-view band header both go through this
 * rather than restating "waiting for you" as "Needs input".
 */
export function capitalizeStatusWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function bucketStatusWord(item: SidebarItem): StatusWord {
  return {
    word: capitalizeStatusWord(getBucketWord(item.bucket)),
    signal: statusSignalForBucket(item.bucket),
  };
}

/**
 * The single coloured word on a row's second line. What the agent is doing
 * wins — it is the thing changing while you look at it — and only the three
 * buckets that are actually about the agent count; `ready`, `idle` and `done`
 * are states of rest and let the pull request speak instead. With neither,
 * the row says nothing rather than padding the line.
 */
export function getStatusWord(item: SidebarItem): StatusWord | null {
  if (item.bucket === 'needs_input' || item.bucket === 'failed' || item.bucket === 'working') {
    return bucketStatusWord(item);
  }

  const pr = item.pullRequest;
  if (!pr) return null;
  if (pr.state === 'conflicts') return { word: 'Merge conflicts', signal: 'warning' };
  if (pr.state === 'merged') return { word: 'Merged', signal: 'merged' };
  if (pr.state === 'changes_requested') return { word: 'Changes requested', signal: 'warning' };
  if (pr.state === 'ready_to_merge' && pr.checks !== 'failing') {
    return { word: 'Ready to merge', signal: 'success' };
  }
  if (pr.checks === 'failing') return { word: 'Checks failed', signal: 'danger' };
  if (pr.state === 'draft') return { word: 'Draft', signal: 'neutral' };
  if (pr.state === 'in_review') return { word: 'In review', signal: 'neutral' };
  // Closed: the glyph already carries it, and "Closed" beside a struck-through
  // PR glyph is the same fact twice.
  return null;
}

/**
 * The right end of a compact row's first line — one slot, four things it can
 * be. An empty diff is not a fact: `+0 -0` on every quiet row was the noise
 * this replaces, so a zero diff falls through to the time. A lane that cannot
 * be counted is a fact, though: its reason takes the count's place rather
 * than a time that says nothing about why there is no count (devstation-ama).
 */
export type TrailingSlot =
  | { kind: 'running'; liveSessionCount: number }
  | { kind: 'diff'; added: number; removed: number }
  | { kind: 'compare_cue'; cue: ItemCompareCue }
  | { kind: 'time' };

export function getTrailingSlot(item: SidebarItem): TrailingSlot {
  if (item.bucket === 'working') {
    return { kind: 'running', liveSessionCount: item.liveSessionCount };
  }
  const diff = item.diffStats;
  if (diff && diff.added + diff.removed > 0) {
    return { kind: 'diff', added: diff.added, removed: diff.removed };
  }
  if (item.compareCue) return { kind: 'compare_cue', cue: item.compareCue };
  return { kind: 'time' };
}

/**
 * Why a single-lane item has no +/−, on its own row: the one lane's
 * `no_upstream` or `unreadable`, which until now only its expanded sub-row
 * said (`work-item-subrows.tsx`). With more lanes the other lanes still count,
 * and each lane's sub-row names the one that does not.
 */
export function resolveItemCompareCue(summary: SidebarSummary | undefined): ItemCompareCue | null {
  if (!summary || summary.worktrees.length !== 1) return null;
  const { compareBase } = summary.worktrees[0]!;
  return compareBase.kind === 'ref' ? null : compareBase;
}

/**
 * Whether the active card has a nested block at all. A single worktree with
 * nothing running and nothing archived would open into one line repeating the
 * row above it, so the card stays one row tall and the list does not jump on
 * every selection.
 */
export function isCardExpandable(summary: SidebarSummary | undefined): boolean {
  if (!summary) return false;
  return (
    summary.worktrees.length > 1 ||
    summary.worktrees.some((worktree) => worktree.liveSessions.length > 0) ||
    summary.archivedLaneCount > 0
  );
}

/** The hover card's one primary action, or none. */
export type HoverCardAction =
  | { kind: 'open_item'; label: string }
  | { kind: 'open_pull_request'; label: string; url: string };

/**
 * The hover card's single state-aware action button. Precedence top to
 * bottom: the agent asking for you outranks everything, a failure outranks a
 * quiet PR, and a PR outranks raw uncommitted work. No git-mutating action
 * (commit, push, merge, archive) belongs here — that was decided against.
 * Nothing to do renders no button; a button that does nothing is worse than
 * an empty card.
 */
export function getHoverCardAction(item: SidebarItem): HoverCardAction | null {
  if (item.needsYou.length > 0 || item.bucket === 'needs_input') {
    return { kind: 'open_item', label: 'Review request' };
  }
  if (item.bucket === 'failed') {
    return { kind: 'open_item', label: 'View failure' };
  }
  if (item.pullRequest) {
    return { kind: 'open_pull_request', label: 'Open pull request', url: item.pullRequest.url };
  }
  const diff = item.diffStats;
  if (diff && diff.added + diff.removed > 0) {
    return { kind: 'open_item', label: 'Review changes' };
  }
  return null;
}

/**
 * The provider whose logo the row wears in Status view: whichever live
 * session was active most recently, and failing that the primary worktree's
 * own provider. Null stays null — a row with no provider falls back to its
 * git glyph rather than to some other item's logo.
 */
export function resolveItemProviderId(summary: SidebarSummary | undefined): string | null {
  if (!summary) return null;

  let newestLive: SidebarLiveSessionSummary | null = null;
  for (const worktree of summary.worktrees) {
    for (const session of worktree.liveSessions) {
      if (!newestLive || session.lastActiveAt > newestLive.lastActiveAt) newestLive = session;
    }
  }
  if (newestLive) return newestLive.providerId;

  const primary = summary.worktrees.find((worktree) => worktree.isPrimary);
  return primary?.providerId ?? null;
}

/**
 * The agent whose logo a session row wears: a chat's own provider, and none
 * for a terminal, which wears the terminal glyph even when an agent runs in
 * it — the centre tab's rule (`describeSessionTab`) and the rail's, so a
 * Claude chat and Claude Code in a terminal stay apart here too
 * (devstation-ceg). Both rows are still named after the agent.
 */
export function getSessionRowProviderId(
  session: Pick<SidebarLiveSessionSummary, 'kind' | 'providerId'>
): AgentProviderId | null {
  return session.kind === 'chat' && isValidProviderId(session.providerId)
    ? session.providerId
    : null;
}
