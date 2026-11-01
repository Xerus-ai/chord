import { err, ok, type Result } from '@shared/result';
import type { AgentSessionRow } from '@main/db/schema-work-items';

/**
 * Pure guard for an explicitly-requested chat session (`sendMessageToAgent`'s
 * `sessionId` argument): it must exist, belong to the work item the caller is
 * acting on, be a `chat` session (not `terminal`), and not be retired.
 *
 * Kept in its own file with NO runtime imports beyond `@shared/result` (the
 * `AgentSessionRow` import is type-only and erased at compile time) so it can
 * be unit tested under plain Node — `resolve-chat-session.ts`, where the rest
 * of this task's decision logic lives, pulls in `@main/db/client` at module
 * scope for its DB-touching helpers and would drag Electron's better-sqlite3
 * binding into a test that only wants this guard.
 */

// Every branch carries an optional `message` alongside its `type` — not
// because callers should match on message text (they must match on `type`),
// but so a caller that generically renders `error.message` (as the existing,
// out-of-scope-for-this-task sendToAgent UI does for `agent_start_failed`)
// gets a sensible string across the WHOLE error union instead of a
// `Property 'message' does not exist` compile error the moment this union
// grows a member.
export type TargetSessionError =
  | { type: 'session_not_found'; message: string }
  | { type: 'session_not_chat'; message: string }
  | { type: 'session_done'; message: string };

export function validateTargetSession(
  row: AgentSessionRow | undefined,
  workItemId: string
): Result<AgentSessionRow, TargetSessionError> {
  if (!row || row.workItemId !== workItemId) {
    return err({ type: 'session_not_found', message: 'That session no longer exists.' });
  }
  if (row.kind !== 'chat') {
    return err({ type: 'session_not_chat', message: 'That session is a terminal, not a chat.' });
  }
  if (row.status === 'done') {
    return err({ type: 'session_done', message: 'That session has ended.' });
  }
  return ok(row);
}
