import { randomUUID } from 'node:crypto';
import type { NotificationType, NotificationView } from '@chord/protocol';
import { db } from '../db/client.js';
import { notifications } from '../db/schema-sharing.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { listNotificationViewsByIds } from './list-notification-views.js';

/** At most this many characters of a message or comment are stored (ck_notifications_excerpt_length). */
export const EXCERPT_LENGTH = 200;

export function excerptOf(text: string): string {
  return text.slice(0, EXCERPT_LENGTH);
}

/**
 * What a producer knows when something happens: who is told, what kind of
 * thing it is, who did it and what it points at. Never a sentence; the app
 * builds that from these facts and the names they point at.
 */
export interface NotificationFact {
  user_id: string;
  type: NotificationType;
  actor_user_id: string;
  org_id?: string;
  work_item_id?: string;
  artifact_id?: string;
  comment_id?: string;
  message_id?: string;
  excerpt?: string;
  /** Live frame only, never stored: the team invite the inline Accept/Decline targets. */
  invite_id?: string;
}

/**
 * The only writer of notifications. One multi-row insert (each neon-http
 * query is a full HTTPS round trip), then one joined read of the new rows,
 * whose views are sent to each recipient's sockets: the live frame is exactly
 * what GET /notifications will return for the row.
 */
export async function insertNotifications(
  manager: ConnectionManager,
  facts: NotificationFact[]
): Promise<void> {
  if (facts.length === 0) return;

  const rows = facts.map((fact) => ({
    id: randomUUID(),
    user_id: fact.user_id,
    type: fact.type,
    actor_user_id: fact.actor_user_id,
    org_id: fact.org_id ?? null,
    work_item_id: fact.work_item_id ?? null,
    artifact_id: fact.artifact_id ?? null,
    comment_id: fact.comment_id ?? null,
    message_id: fact.message_id ?? null,
    excerpt: fact.excerpt === undefined ? null : excerptOf(fact.excerpt),
  }));
  await db.insert(notifications).values(rows);

  const views = new Map(
    (await listNotificationViewsByIds(rows.map((row) => row.id))).map((view) => [view.id, view])
  );
  rows.forEach((row, index) => {
    const view = views.get(row.id);
    if (!view) throw new Error(`[notifications] ${row.id} was not readable after its insert`);
    const inviteId = facts[index]!.invite_id;
    const payload: NotificationView = inviteId ? { ...view, invite_id: inviteId } : view;
    manager.broadcastToUser(row.user_id, { type: 'notification_received', payload });
  });
}
