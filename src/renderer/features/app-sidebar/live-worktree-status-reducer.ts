import type { AgentEvent } from '@shared/events/agentEvents';
import type { StreamItem, TurnStreamAction, TurnStreamEvent } from '@shared/stream-items';

/**
 * Pure state machine behind `useLiveWorktreeStatus` (T0.7). Tracks which agent
 * *sessions* are currently streaming, then derives per-worktree and
 * per-work-item views from that — a work item is "running" if any of its
 * sessions are, and a worktree is "streaming" if its one session is, even
 * while a sibling worktree on the same work item has already stopped.
 *
 * The guard against a late seed resurrecting a session the live stream has
 * already retired is keyed by *session*, not work item: two sessions on two
 * worktrees of the same work item must be able to stop independently.
 *
 * It also tracks which sessions are blocked on the user (a pending permission
 * or plan approval), from two live sources: hook `permission_prompt` /
 * `elicitation_dialog` notifications (PTY agents) and turn-stream
 * `permission` / `plan_approval` items (ACP and SDK chats).
 */

export interface LiveSessionRef {
  sessionId: string;
  workItemId: string;
  worktreeId: string;
}

type PendingInput = Map<string, ReadonlySet<string>>;

export interface LiveWorktreeStatusState {
  /** Sessions the live stream currently considers running. */
  sessions: Map<string, LiveSessionRef>;
  /** Sessions the stream has already retired — a seed arriving after must not resurrect them. */
  stoppedSessionIds: Set<string>;
  /** Derived: `sessions` keys, precomputed so selectors return a stable identity. */
  streamingSessionIds: Set<string>;
  /** Derived: distinct `worktreeId`s of `sessions`. */
  streamingWorktreeIds: Set<string>;
  /** Derived: distinct `workItemId`s of `sessions`. */
  runningWorkItemIds: Set<string>;
  /** Per session, the keys of requests still waiting on the user. Never holds an empty set. */
  pendingInput: PendingInput;
  /** Derived: `pendingInput` keys, precomputed so selectors return a stable identity. */
  pendingInputSessionIds: Set<string>;
  /**
   * Sessions a turn-stream event has spoken for at least once. Guards
   * `applyPendingInputSeed` the way `stoppedSessionIds` guards `applySeed`:
   * a session the live stream already cleared (resolved its only pending
   * item) has no trace left in `pendingInput` to check against, so without
   * this a late seed would wrongly resurrect it as pending.
   */
  turnStreamTouchedSessionIds: Set<string>;
}

/** Hook prompts carry no request id, so a session has at most one. */
const HOOK_PROMPT_KEY = 'hook';

/**
 * Placeholder key for `applyPendingInputSeed`: the seed RPC only reports
 * "this session has a pending card", not which item, so it can't be keyed by
 * request id like a real turn-stream item. Cleared the moment any real
 * turn-stream event arrives for the session — the live stream is always
 * fresher than the mount-time snapshot it's standing in for.
 */
const SEED_KEY = 'seed';

const PENDING_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'permission_prompt',
  'elicitation_dialog',
]);

export function createInitialLiveWorktreeStatusState(): LiveWorktreeStatusState {
  return {
    sessions: new Map(),
    stoppedSessionIds: new Set(),
    streamingSessionIds: new Set(),
    streamingWorktreeIds: new Set(),
    runningWorkItemIds: new Set(),
    pendingInput: new Map(),
    pendingInputSessionIds: new Set(),
    turnStreamTouchedSessionIds: new Set(),
  };
}

function deriveFrom(
  sessions: Map<string, LiveSessionRef>,
  stoppedSessionIds: Set<string>,
  pendingInput: PendingInput,
  turnStreamTouchedSessionIds: Set<string>
): LiveWorktreeStatusState {
  const streamingSessionIds = new Set<string>();
  const streamingWorktreeIds = new Set<string>();
  const runningWorkItemIds = new Set<string>();
  for (const ref of sessions.values()) {
    streamingSessionIds.add(ref.sessionId);
    streamingWorktreeIds.add(ref.worktreeId);
    runningWorkItemIds.add(ref.workItemId);
  }
  return {
    sessions,
    stoppedSessionIds,
    streamingSessionIds,
    streamingWorktreeIds,
    runningWorkItemIds,
    pendingInput,
    pendingInputSessionIds: new Set(pendingInput.keys()),
    turnStreamTouchedSessionIds,
  };
}

function setPendingKey(
  pendingInput: PendingInput,
  sessionId: string,
  key: string,
  pending: boolean
): PendingInput {
  const keys = pendingInput.get(sessionId);
  if (pending === (keys?.has(key) ?? false)) return pendingInput;
  const nextKeys = new Set(keys);
  if (pending) nextKeys.add(key);
  else nextKeys.delete(key);
  const next = new Map(pendingInput);
  if (nextKeys.size === 0) next.delete(sessionId);
  else next.set(sessionId, nextKeys);
  return next;
}

function clearPending(pendingInput: PendingInput, sessionId: string): PendingInput {
  if (!pendingInput.has(sessionId)) return pendingInput;
  const next = new Map(pendingInput);
  next.delete(sessionId);
  return next;
}

/**
 * Route one live `AgentEvent` into the state. Events with no `workItemId`
 * (the classifier path — see `event-enricher.ts` vs `classifier-wiring.ts`)
 * are skipped, matching the pre-T0.7 behaviour: only hook-sourced events
 * (which always carry `workItemId`) drive running/streaming state.
 */
export function applyAgentEvent(
  state: LiveWorktreeStatusState,
  event: Pick<AgentEvent, 'type' | 'workItemId' | 'sessionId' | 'worktreeId' | 'payload'>
): LiveWorktreeStatusState {
  if (!event.workItemId) return state;
  const { sessionId, workItemId, worktreeId } = event;

  if (event.type === 'notification') {
    // Any later hook notification means the agent has moved past its prompt.
    // It also supersedes the mount-time seed: a PTY session never emits
    // turn-stream events, so nothing else would clear its placeholder.
    const pendingInput = setPendingKey(
      setPendingKey(state.pendingInput, sessionId, SEED_KEY, false),
      sessionId,
      HOOK_PROMPT_KEY,
      PENDING_NOTIFICATION_TYPES.has(event.payload.notificationType ?? '')
    );
    const stoppedSessionIds = state.stoppedSessionIds.has(sessionId)
      ? new Set(state.stoppedSessionIds)
      : state.stoppedSessionIds;
    stoppedSessionIds.delete(sessionId);
    const existing = state.sessions.get(sessionId);
    if (existing && existing.workItemId === workItemId && existing.worktreeId === worktreeId) {
      return stoppedSessionIds === state.stoppedSessionIds && pendingInput === state.pendingInput
        ? state
        : deriveFrom(
            state.sessions,
            stoppedSessionIds,
            pendingInput,
            state.turnStreamTouchedSessionIds
          );
    }
    const sessions = new Map(state.sessions);
    sessions.set(sessionId, { sessionId, workItemId, worktreeId });
    return deriveFrom(sessions, stoppedSessionIds, pendingInput, state.turnStreamTouchedSessionIds);
  }

  if (event.type === 'stop' || event.type === 'error') {
    const stoppedSessionIds = new Set(state.stoppedSessionIds);
    stoppedSessionIds.add(sessionId);
    const pendingInput = clearPending(state.pendingInput, sessionId);
    if (!state.sessions.has(sessionId)) {
      return deriveFrom(
        state.sessions,
        stoppedSessionIds,
        pendingInput,
        state.turnStreamTouchedSessionIds
      );
    }
    const sessions = new Map(state.sessions);
    sessions.delete(sessionId);
    return deriveFrom(sessions, stoppedSessionIds, pendingInput, state.turnStreamTouchedSessionIds);
  }

  return state;
}

/**
 * Fold in a snapshot of sessions that were already live before this hook
 * mounted (`agentSessions.listRunningSessions`). A session the stream has
 * already stopped stays stopped even if the seed still lists it — the seed
 * request can resolve after a 'stop' event that raced ahead of it.
 */
export function applySeed(
  state: LiveWorktreeStatusState,
  rows: readonly LiveSessionRef[]
): LiveWorktreeStatusState {
  const seeded = rows.filter((row) => !state.stoppedSessionIds.has(row.sessionId));
  if (seeded.length === 0) return state;
  const sessions = new Map(state.sessions);
  let changed = false;
  for (const row of seeded) {
    if (sessions.has(row.sessionId)) continue;
    sessions.set(row.sessionId, row);
    changed = true;
  }
  if (!changed) return state;
  return deriveFrom(
    sessions,
    state.stoppedSessionIds,
    state.pendingInput,
    state.turnStreamTouchedSessionIds
  );
}

/**
 * Fold in a snapshot of sessions with a pending permission/plan card that
 * were already blocked on the user before this hook mounted
 * (`agentSessions.listPendingInputSessions`) — the counterpart to `applySeed`
 * for the needs-input dot: without it, a request pending at mount only shows
 * up on its next turn-stream event. Skips a session the live turn-stream has
 * already spoken for at all (`turnStreamTouchedSessionIds`), whether it's
 * currently pending or was already resolved — the RPC snapshot predates
 * mount, the live stream doesn't.
 */
export function applyPendingInputSeed(
  state: LiveWorktreeStatusState,
  rows: readonly LiveSessionRef[]
): LiveWorktreeStatusState {
  let pendingInput = state.pendingInput;
  for (const row of rows) {
    if (state.stoppedSessionIds.has(row.sessionId)) continue;
    if (state.turnStreamTouchedSessionIds.has(row.sessionId)) continue;
    pendingInput = setPendingKey(pendingInput, row.sessionId, SEED_KEY, true);
  }
  if (pendingInput === state.pendingInput) return state;
  return deriveFrom(
    state.sessions,
    state.stoppedSessionIds,
    pendingInput,
    state.turnStreamTouchedSessionIds
  );
}

/** Whether a stream item is a request still waiting on the user; null for other kinds. */
function isItemPending(item: StreamItem): boolean | null {
  if (item.kind === 'permission') return !item.resolved;
  if (item.kind === 'question') return item.status === 'pending';
  if (item.kind === 'plan_approval') return item.status === 'pending';
  return null;
}

function applyTurnStreamAction(
  pendingInput: PendingInput,
  sessionId: string,
  action: TurnStreamAction
): PendingInput {
  switch (action.type) {
    case 'item_added':
    case 'item_updated': {
      const pending = isItemPending(action.item);
      if (pending === null) return pendingInput;
      return setPendingKey(pendingInput, sessionId, action.item.id, pending);
    }
    case 'turn_completed':
      return clearPending(pendingInput, sessionId);
    case 'items_batch':
      return action.actions.reduce(
        (acc, inner) => applyTurnStreamAction(acc, sessionId, inner),
        pendingInput
      );
    case 'turn_started':
      return pendingInput;
  }
}

/**
 * Route one live turn-stream event into the pending-input view. A permission
 * card or pending plan approval sets it; resolving the card, any non-pending
 * plan status (approved, rejected, adjusted, expired), or the turn completing
 * clears it. Events with no `sessionId` (turns predating Phase 1) are skipped.
 *
 * Also marks the session as touched by the live stream (see
 * `turnStreamTouchedSessionIds`), including when the event itself is a no-op
 * for `pendingInput` — a `turn_started` or a text update still proves the
 * live stream is now authoritative for this session, so a seed arriving
 * after it must not override what already happened.
 */
export function applyTurnStreamEvent(
  state: LiveWorktreeStatusState,
  event: Pick<TurnStreamEvent, 'sessionId' | 'action'>
): LiveWorktreeStatusState {
  if (!event.sessionId) return state;
  // The live stream is authoritative the moment it speaks for this session —
  // drop the mount-time seed placeholder first so it can't outlive it (a
  // seeded session that only ever gets non-request events, e.g. its next
  // `text` chunk, would otherwise stay "pending" forever).
  const unseeded = setPendingKey(state.pendingInput, event.sessionId, SEED_KEY, false);
  const pendingInput = applyTurnStreamAction(unseeded, event.sessionId, event.action);
  const touched = state.turnStreamTouchedSessionIds.has(event.sessionId)
    ? state.turnStreamTouchedSessionIds
    : new Set(state.turnStreamTouchedSessionIds).add(event.sessionId);
  if (pendingInput === state.pendingInput && touched === state.turnStreamTouchedSessionIds) {
    return state;
  }
  return deriveFrom(state.sessions, state.stoppedSessionIds, pendingInput, touched);
}
