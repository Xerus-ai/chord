import type {
  SidebarDiffStats,
  SidebarLiveSessionSummary,
  SidebarSubagentSummary,
  SidebarWorktreeSummary,
} from '@shared/sidebar-summaries';
import { deriveWorktreeStatus, type WorktreeStatusInput } from '@shared/work-item-status';

/** A local `agent_sessions` row already resolved to this worktree (null
 * `worktree_id` mapped to the primary by the caller). */
export interface WorktreeSessionFacts {
  id: string;
  status: string;
  /** `agent_sessions.kind`: 'chat' or 'terminal'. */
  kind: string;
  agentProviderId: string | null;
  title: string | null;
  createdAt: number;
  lastActiveAt: number;
  /** `agent_sessions.last_turn_status` — 'error' when this session's most
   * recently completed turn ended in error, null otherwise. Written by
   * `AgentEventBridge.completeTurn` / `recordSessionTurnOutcome`
   * (persist-agent-turn.ts). */
  lastTurnStatus: string | null;
}

/** What the in-memory session registry knows about a session resolved to
 * this worktree. `subagents` has no `lastActiveAt`: `SubagentItem`
 * (src/shared/stream-items.ts) carries no timestamp, so the field is omitted
 * rather than stamped with `Date.now()`. */
export interface WorktreeLiveSessionFacts {
  sessionId: string;
  isTurnStreaming: boolean;
  subagents: SidebarSubagentSummary[];
}

export interface BuildWorktreeSummaryInput {
  id: string;
  branch: string | null;
  targetRef: string | null;
  title: string | null;
  isPrimary: boolean;
  diffStats: SidebarDiffStats | null;
  /** Every local `agent_sessions` row resolved to this worktree. */
  sessions: readonly WorktreeSessionFacts[];
  /** The subset of `sessions` currently held in main-process memory. */
  liveSessions: readonly WorktreeLiveSessionFacts[];
  pendingPermissionRequests: number;
  pendingPlanRequests: number;
  /** Worktree-level, not session-level: `work_item_worktrees.git_last_error`
   * is non-null (see git-operation-status.ts). `lastTurnErrored` is deliberately
   * not accepted here — it is derived from `sessions[].lastTurnStatus` below,
   * so a caller can never pass it out of sync with the session facts it also
   * passes. */
  gitOperationFailed: boolean;
  hasUnreadFinishedTurn: boolean;
}

/**
 * Creation order, oldest first — deliberately not the rail's recency order
 * (`session-row-presentation.ts`, `orderSessionRows`).
 *
 * The rail is the inventory of everything that ever ran in the work item, and
 * "when did I last touch it" is the question a user brings to that list. The
 * sidebar lists only what is running now, and its rows sit under the cursor:
 * ordering them by activity would move a row every time an agent spoke. New
 * sessions append at the end and stay there (product call, devstation-20r).
 *
 * The session rows arrive from an unordered query, so the order is set here,
 * not left to the database. Ties fall back to the id so two sessions created
 * in the same second keep one order between polls.
 */
function orderLiveSessions(sessions: readonly WorktreeSessionFacts[]): WorktreeSessionFacts[] {
  return [...sessions].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  );
}

/**
 * Builds one worktree's sidebar row: its status bucket (via the shared pure
 * derivation) plus the live session/subagent rows the tree view expands
 * into. Pure — every fact arrives pre-resolved so this has no I/O and no
 * import of `db` or the in-memory session registry, which is what makes it
 * testable without mocking either.
 */
/** Everything but `compareBase`, which comes with the diff stats it qualifies (`worktree-diff-stats.ts`). */
export function buildWorktreeSummary(
  input: BuildWorktreeSummaryInput
): Omit<SidebarWorktreeSummary, 'compareBase'> {
  const newestSession = input.sessions.reduce<WorktreeSessionFacts | null>(
    (best, session) => (!best || session.createdAt > best.createdAt ? session : best),
    null
  );

  const isTurnStreaming = input.liveSessions.some((session) => session.isTurnStreaming);
  const lastTurnErrored = input.sessions.some((session) => session.lastTurnStatus === 'error');

  const statusInput: WorktreeStatusInput = {
    pendingPermissionRequests: input.pendingPermissionRequests,
    pendingPlanRequests: input.pendingPlanRequests,
    sessionStatuses: input.sessions.map((session) => session.status),
    lastTurnErrored,
    gitOperationFailed: input.gitOperationFailed,
    isTurnStreaming,
    hasUnreadFinishedTurn: input.hasUnreadFinishedTurn,
  };

  const liveById = new Map(input.liveSessions.map((session) => [session.sessionId, session]));
  const liveSessions: SidebarLiveSessionSummary[] = orderLiveSessions(
    input.sessions.filter((session) => liveById.has(session.id))
  ).map((session) => ({
    sessionId: session.id,
    kind: session.kind,
    title: session.title,
    lastActiveAt: session.lastActiveAt,
    providerId: session.agentProviderId,
    subagents: liveById.get(session.id)!.subagents,
  }));

  return {
    id: input.id,
    branch: input.branch,
    targetRef: input.targetRef,
    title: input.title,
    isPrimary: input.isPrimary,
    diffStats: input.diffStats,
    providerId: newestSession?.agentProviderId ?? null,
    bucket: deriveWorktreeStatus(statusInput),
    liveSessions,
  };
}

/** A `published_permission_requests` / `published_plan_requests` row with
 * status 'pending'. Both tables carry an optional `sessionId`; a request
 * with no session (published before the agent session existed, or from a
 * session this device never launched) falls back to the work item's
 * attribution the caller resolved. */
export interface PendingRequestRow {
  workItemId: string;
  sessionId: string | null;
}

/**
 * Attributes each pending request to a worktree: by its session's worktree
 * when it has one, otherwise by the caller's per-work-item fallback (the
 * newest live session's worktree, else the primary — see
 * sidebar-summaries.ts). A request whose work item has no fallback entry
 * (should not happen — every work item has a primary worktree) is dropped
 * rather than guessed.
 */
export function attributePendingRequests(
  rows: readonly PendingRequestRow[],
  sessionWorktreeId: ReadonlyMap<string, string>,
  fallbackWorktreeId: ReadonlyMap<string, string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const worktreeId =
      (row.sessionId ? sessionWorktreeId.get(row.sessionId) : undefined) ??
      fallbackWorktreeId.get(row.workItemId);
    if (!worktreeId) continue;
    counts.set(worktreeId, (counts.get(worktreeId) ?? 0) + 1);
  }
  return counts;
}

/**
 * A worktree is unread when it has a finished turn newer than the user's
 * last view of the work item. No turn at all is never unread — there is
 * nothing to read. A work item the user has never viewed (`lastViewedAt`
 * missing) treats any turn as unread, per the design's "missing entry means
 * unread" rule.
 */
export function computeUnread(
  newestTurnAt: number | null,
  lastViewedAt: number | undefined
): boolean {
  if (newestTurnAt === null) return false;
  return newestTurnAt > (lastViewedAt ?? 0);
}
