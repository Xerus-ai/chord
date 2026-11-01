/**
 * Which live session a teammate's command is delivered into.
 *
 * Commands have always carried the thread they were issued in —
 * `commands.session_id` (protocol `packages/protocol/src/commands.ts`,
 * validated at insert in `server/src/routes/commands.ts`) — but the owner's
 * device ignored it and delivered into whichever chat session happened to come
 * first. With one session that was invisible; with two it silently sent a
 * teammate's prompt to the wrong agent, the same failure that made the Room's
 * bare `@claude` untrustworthy.
 *
 * A named session that is not live parks the command rather than falling back.
 * Falling back is what made the bug: the teammate addressed a thread, and
 * delivering somewhere else is a wrong answer, not a lenient one. The chat row
 * is already durable either way, so parking loses no message — only the wake.
 *
 * Pure and dependency-free so it can be tested without Electron or a database.
 */
export interface TargetableSession {
  sessionId: string;
  kind: string;
}

export function selectCommandTargetSession<T extends TargetableSession>(
  sessions: readonly T[],
  requestedSessionId: string | null | undefined
): T | undefined {
  const chats = sessions.filter((session) => session.kind === 'chat');
  if (!requestedSessionId) return chats[0];
  return chats.find((session) => session.sessionId === requestedSessionId);
}
