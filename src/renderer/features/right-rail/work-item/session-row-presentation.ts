import type { AgentSessionRow } from '@main/db/schema-work-items';
import type { StatusSignal } from '@renderer/lib/status-dot';

/**
 * How one session row reads in the Work item map.
 *
 * Pure, and separate from `worktree-group.tsx`, for the same reason the
 * sidebar keeps `row-presentation.ts`: the precedence between a session's
 * lifecycle and its last turn's outcome is a rule, and a rule belongs
 * somewhere it can be stated once and tested.
 */
export interface SessionRowStatus {
  /** Whether the row animates. Only a session actually running a turn does. */
  live: boolean;
  /** The meta line's word — present tense, lower case, as in `getStatusWord`. */
  word: string;
  signal: StatusSignal;
  /** A live session's age is noise; every other state needs it. */
  showAge: boolean;
}

/** The value of `agent_sessions.last_turn_status` that marks a failed turn. */
const TURN_ERROR = 'error';

/** The `agent_sessions.status` of a session that is over and takes no more messages. */
export const SESSION_DONE_STATUS = 'done';

/**
 * What a session that is over is called, wherever it is shown: this map's
 * pill and both `+` menus (`ended-chats-menu-section.tsx`,
 * `cloud-chat-launcher-menu.tsx`). The rail printed the raw status, "done",
 * beside menus saying "Ended" (devstation-vzg) — one word for one state.
 */
export const ENDED_SESSION_WORD = 'ended';

/**
 * `status` is the session's lifecycle ('active' | 'suspended' | 'done' — see
 * `work-item-status.ts`); `last_turn_status` is the outcome of its last
 * finished turn, deliberately kept separate so a resumed session is not
 * silently un-flagged (`schema-work-items.ts:126-135`). The map showed only
 * the first, which is why a failed session was indistinguishable from an idle
 * one here while the sidebar flagged it.
 *
 * Failure outranks the lifecycle, matching `deriveWorktreeStatus`, where
 * failed beats working: a live session whose last turn errored must not pulse
 * as though nothing were wrong.
 */
export function sessionRowStatus(session: AgentSessionRow): SessionRowStatus {
  if (session.lastTurnStatus === TURN_ERROR) {
    return { live: false, word: 'failed', signal: 'danger', showAge: true };
  }
  if (session.status === 'active') {
    return { live: true, word: 'live', signal: 'running', showAge: false };
  }
  return { live: false, word: restingSessionWord(session), signal: 'neutral', showAge: true };
}

/**
 * A suspended chat has no process, and the next send resumes its conversation
 * (`deliver-to-session.ts`), so it is ready, not "suspended" — a Reset leaves
 * its chat this way (devstation-6z4o). A suspended terminal resumes when it is
 * opened, not on a send, and keeps its lifecycle word.
 */
function restingSessionWord(session: AgentSessionRow): string {
  if (session.status === SESSION_DONE_STATUS) return ENDED_SESSION_WORD;
  if (session.status === 'suspended' && session.kind === 'chat') return 'ready';
  return session.status;
}

/**
 * Recency order, newest first, across every status.
 *
 * The map lists finished sessions inline rather than behind a disclosure — it
 * is the inventory of everything that ever ran in this work item, while the
 * sidebar is what is running now. One order has to carry all three states, and
 * "when did I last touch it" is the question a user brings to a session list.
 *
 * Ties fall back to creation time: `last_active_at` is second-granularity, so
 * two sessions touched in the same second would otherwise swap places between
 * the panel's five-second polls.
 */
export function orderSessionRows(sessions: readonly AgentSessionRow[]): AgentSessionRow[] {
  return [...sessions].sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt || right.createdAt - left.createdAt
  );
}
