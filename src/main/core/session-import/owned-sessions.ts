import { eq, isNotNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agentSessionSupersededIds } from '@main/db/schema-agent-session-history';
import { agentSessions } from '@main/db/schema-work-items';

/**
 * Every agent-side session id a Chord session holds, in any work item and of
 * any kind: a conversation Chord runs, or already imported, is not offered.
 * Nor is one a chat held before its current one (a Reset leaves it on disk).
 */
export function readOwnedExternalSessionIds(): Set<string> {
  const current = db
    .select({ externalSessionId: agentSessions.externalSessionId })
    .from(agentSessions)
    .where(isNotNull(agentSessions.externalSessionId))
    .all();
  const superseded = db
    .select({ externalSessionId: agentSessionSupersededIds.externalSessionId })
    .from(agentSessionSupersededIds)
    .all();
  return new Set([
    ...current.map((row) => row.externalSessionId as string),
    ...superseded.map((row) => row.externalSessionId),
  ]);
}

/** The Chord session holding `externalSessionId`, now or before its current one. */
export function findSessionHolding(
  externalSessionId: string
): { sessionId: string; workItemId: string } | null {
  const [current] = db
    .select({ sessionId: agentSessions.id, workItemId: agentSessions.workItemId })
    .from(agentSessions)
    .where(eq(agentSessions.externalSessionId, externalSessionId))
    .limit(1)
    .all();
  if (current) return current;
  const [earlier] = db
    .select({ sessionId: agentSessions.id, workItemId: agentSessions.workItemId })
    .from(agentSessionSupersededIds)
    .innerJoin(agentSessions, eq(agentSessions.id, agentSessionSupersededIds.sessionId))
    .where(eq(agentSessionSupersededIds.externalSessionId, externalSessionId))
    .limit(1)
    .all();
  return earlier ?? null;
}
