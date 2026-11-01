import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agentSessionSupersededIds } from '@main/db/schema-agent-session-history';
import { agentSessions } from '@main/db/schema-work-items';

/**
 * Per CHAT SESSION, what a respawned session needs to resume rather than
 * start over: whether it has run this app session, and the agent-side id of
 * its conversation. Keyed by session id, never by work item — two chats in
 * one work item are two conversations, and a work-item key handed one chat's
 * conversation to the other. Terminals never read or write this.
 */
const startedChats = new Set<string>();
const resumableExternalIds = new Map<string, string>();

/** Seeds the state from the sessions a previous app run left resumable. */
export function restoreChatResumeState(resumable: Iterable<[string, string]>): void {
  for (const [sessionId, externalId] of resumable) {
    startedChats.add(sessionId);
    resumableExternalIds.set(sessionId, externalId);
  }
}

export function markChatStarted(sessionId: string): void {
  startedChats.add(sessionId);
}

export function hasChatStarted(sessionId: string): boolean {
  return startedChats.has(sessionId);
}

export function getResumableExternalId(sessionId: string): string | undefined {
  return resumableExternalIds.get(sessionId);
}

/**
 * A chat session's agent-side id: persisted on its row and kept for
 * respawn-resume. An id it replaces (a Reset's fork, a resume the agent
 * started over) is kept as superseded: that conversation is still this chat's.
 */
export function recordChatExternalId(sessionId: string, externalId: string): void {
  db.transaction((tx) => {
    const [row] = tx
      .select({ externalSessionId: agentSessions.externalSessionId })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .all();
    const previous = row?.externalSessionId ?? null;
    if (previous !== null && previous !== externalId) {
      tx.insert(agentSessionSupersededIds)
        .values({ sessionId, externalSessionId: previous })
        .onConflictDoNothing()
        .run();
    }
    tx.update(agentSessions)
      .set({ externalSessionId: externalId, lastActiveAt: Math.floor(Date.now() / 1000) })
      .where(eq(agentSessions.id, sessionId))
      .run();
  });
  resumableExternalIds.set(sessionId, externalId);
}
