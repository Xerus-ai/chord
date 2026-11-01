import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';

/**
 * Record the model a session actually launched with.
 *
 * Called from the one place every transport passes through —
 * `session-service.ts`, right after `resolveChatLaunchConfig` — so claude-sdk,
 * ACP and PTY all record it without per-transport code, and a session that
 * relaunches under a changed model overwrites its row.
 *
 * Not called from `agent-sessions/controller.ts`'s inserts: a row exists
 * before it launches, and a session that never starts must not claim a model.
 * Null is the honest value there.
 *
 * `model` is already `resolveModelForProvider`-resolved by the caller, so a
 * value left behind by another agent never lands in the column; null is a real
 * answer meaning "the provider's own default", and overwrites a previous name
 * rather than leaving the row claiming a model it is no longer running.
 */
export function recordLaunchedModel(sessionId: string, model: string | null): void {
  db.update(agentSessions).set({ model }).where(eq(agentSessions.id, sessionId)).run();
}
