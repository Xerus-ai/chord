import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { getActiveSession, getActiveSessions } from './active-sessions';
import { waitForSessionExit } from './session-exit-waiters';
import { stopSession } from './session-service';

// How long a stopped session's process gets to exit before the checkout is
// removed anyway (the removal then reports what still holds it).
const EXIT_WAIT_MS = 5_000;

/**
 * Stops a session and waits for its process to be gone. `stopSession` only
 * asks it to go; the exit lands later, and a checkpoint e2e run removed its
 * worktree 67 ms before the agent's process exited — "Permission denied",
 * folder left behind.
 */
async function stopAndAwaitExit(sessionId: string): Promise<void> {
  const exited = waitForSessionExit(sessionId, EXIT_WAIT_MS);
  await stopSession(sessionId);
  if (!(await exited)) {
    log.warn('[work-items] session still running after stop; removing its checkout anyway', {
      sessionId,
    });
  }
}

/**
 * Stops what still runs inside a checkout about to be removed. A session's
 * process — a terminal tab's shell, an agent — keeps its cwd in the checkout,
 * and on Windows `git worktree remove` then fails ("Permission denied") and
 * the folder stays on disk for good. Deleting a work item with a terminal open
 * left its worktree behind exactly so.
 */
export async function stopWorkItemSessions(workItemId: string): Promise<void> {
  await Promise.all(
    getActiveSessions(workItemId).map((session) => stopAndAwaitExit(session.sessionId))
  );
}

/** The same for one lane being archived: the sessions bound to that worktree. */
export async function stopWorktreeSessions(worktreeId: string): Promise<void> {
  const rows = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(eq(agentSessions.worktreeId, worktreeId))
    .all();
  await Promise.all(
    rows.filter(({ id }) => getActiveSession(id)).map(({ id }) => stopAndAwaitExit(id))
  );
}
