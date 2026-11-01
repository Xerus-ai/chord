import type { AgentEvent } from '@shared/events/agentEvents';

/**
 * The latest unanswered hook prompt (PTY permission / elicitation dialog) per
 * agent session, so `agentSessions.listPendingInputSessions` can seed the
 * needs-input dot at mount for sessions whose prompt arrived before the
 * renderer was listening. Same semantics as the renderer's
 * `live-worktree-status-reducer.ts`: a pending notification sets it, any later
 * notification means the agent moved past its prompt, and stop/error clears
 * it. In-memory on purpose — a prompt dies with the process that asked it.
 */

export interface PendingHookPrompt {
  sessionId: string;
  workItemId: string;
  worktreeId: string;
}

const PENDING_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'permission_prompt',
  'elicitation_dialog',
]);

const promptBySession = new Map<string, PendingHookPrompt>();

export function recordHookPromptEvent(
  event: Pick<AgentEvent, 'type' | 'workItemId' | 'sessionId' | 'worktreeId' | 'payload'>
): void {
  const pending =
    event.type === 'notification' &&
    PENDING_NOTIFICATION_TYPES.has(event.payload.notificationType ?? '');
  if (!pending) {
    promptBySession.delete(event.sessionId);
    return;
  }
  if (!event.workItemId) throw new Error(`Hook prompt has no workItemId: ${event.sessionId}`);
  promptBySession.set(event.sessionId, {
    sessionId: event.sessionId,
    workItemId: event.workItemId,
    worktreeId: event.worktreeId,
  });
}

export function clearHookPrompt(sessionId: string): void {
  promptBySession.delete(sessionId);
}

/**
 * Pending prompts of sessions still live. A session that stopped without a
 * final hook (killed PTY, app-side stop) is dropped here, so the tracker never
 * reports — or keeps — a prompt nobody can answer.
 */
export function listPendingHookPrompts(liveSessionIds: ReadonlySet<string>): PendingHookPrompt[] {
  for (const sessionId of promptBySession.keys()) {
    if (!liveSessionIds.has(sessionId)) promptBySession.delete(sessionId);
  }
  return [...promptBySession.values()];
}
