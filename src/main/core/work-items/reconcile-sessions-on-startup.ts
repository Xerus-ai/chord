import { and, eq } from 'drizzle-orm';
import { forgetEndedSession } from '@main/core/agent-sessions/forget-ended-session';
import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';

/**
 * Boot-time cleanup of session rows no process survived: every `active` row
 * is suspended, and suspended chat rows are reconciled. Returns, per chat
 * SESSION, the external id of the conversation it resumes.
 */
export function reconcileSessionsOnStartup(): Map<string, string> {
  const now = Math.floor(Date.now() / 1000);

  const stale = db.select().from(agentSessions).where(eq(agentSessions.status, 'active')).all();
  for (const row of stale) {
    db.update(agentSessions)
      .set({ status: 'suspended', lastActiveAt: now })
      .where(eq(agentSessions.id, row.id))
      .run();
  }
  if (stale.length > 0) {
    log.info('session-service: suspended stale sessions on startup', { count: stale.length });
  }

  // Reconcile suspended chat rows: rows created one-per-cold-start for the
  // same conversation (same external session id) collapse to the newest, and
  // rows that never obtained an external session id can never resume — both
  // are retired to 'done' so they leave the session list for good.
  const suspendedChats = db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.status, 'suspended'), eq(agentSessions.kind, 'chat')))
    .all();

  const newestPerConversation = new Map<string, (typeof suspendedChats)[number]>();
  const retired: Array<{ id: string; workItemId: string }> = [];
  for (const row of suspendedChats) {
    if (!row.externalSessionId) {
      retired.push({ id: row.id, workItemId: row.workItemId });
      continue;
    }
    const key = `${row.workItemId}:${row.externalSessionId}`;
    const current = newestPerConversation.get(key);
    if (!current) {
      newestPerConversation.set(key, row);
    } else if (row.lastActiveAt > current.lastActiveAt) {
      retired.push({ id: current.id, workItemId: current.workItemId });
      newestPerConversation.set(key, row);
    } else {
      retired.push({ id: row.id, workItemId: row.workItemId });
    }
  }
  for (const { id, workItemId } of retired) {
    db.update(agentSessions)
      .set({ status: 'done', lastActiveAt: now })
      .where(eq(agentSessions.id, id))
      .run();
    forgetEndedSession(id);
    // Boot-time cleanup of rows no process survived. Without this a
    // participant keeps a tab for a thread that died with the last run —
    // the debounce re-checks isSyncTarget, so a not-yet-shared item is a
    // no-op.
    scheduleSessionCloudSync(workItemId);
  }
  if (retired.length > 0) {
    log.info('session-service: retired unresumable/duplicate chat rows', {
      count: retired.length,
    });
  }

  // Every surviving chat session resumes its own conversation — not one per
  // work item: a work item may hold several chats, and each must come back
  // after a restart. Terminals never enter this (their ids are private).
  const resumable = new Map<string, string>();
  for (const row of newestPerConversation.values()) {
    resumable.set(row.id, row.externalSessionId as string);
  }
  return resumable;
}
