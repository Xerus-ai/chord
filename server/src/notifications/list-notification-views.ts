import { NotificationTypeSchema, type NotificationView } from '@chord/protocol';
import { desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import { artifacts } from '../db/schema-artifacts.js';
import { notifications } from '../db/schema-sharing.js';
import { organizations, users, workItems } from '../db/schema.js';

/**
 * Notifications as the app reads them: the stored facts plus the names they
 * point at (actor, team, work item and its repo, artifact), in one query with
 * left joins. A pointer nulled by a delete (ON DELETE SET NULL) joins nothing,
 * so its name is null too. GET /notifications and the live frame
 * (insert-notifications.ts) both come from here, so they cannot differ.
 */

const actor = alias(users, 'actor');

async function selectViews(where: SQL, limit?: number): Promise<NotificationView[]> {
  const query = db
    .select({
      id: notifications.id,
      type: notifications.type,
      actor_user_id: notifications.actor_user_id,
      actor_name: actor.name,
      actor_email: actor.email,
      actor_avatar_url: actor.avatar_url,
      org_id: notifications.org_id,
      org_name: organizations.name,
      work_item_id: notifications.work_item_id,
      work_item_name: workItems.name,
      work_item_repo_name: workItems.repo_name,
      artifact_id: notifications.artifact_id,
      artifact_name: artifacts.name,
      comment_id: notifications.comment_id,
      message_id: notifications.message_id,
      excerpt: notifications.excerpt,
      read: notifications.read,
      created_at: notifications.created_at,
    })
    .from(notifications)
    .leftJoin(actor, eq(actor.id, notifications.actor_user_id))
    .leftJoin(organizations, eq(organizations.id, notifications.org_id))
    .leftJoin(workItems, eq(workItems.id, notifications.work_item_id))
    .leftJoin(artifacts, eq(artifacts.id, notifications.artifact_id))
    .where(where)
    .orderBy(desc(notifications.created_at));
  const rows = limit === undefined ? await query : await query.limit(limit);

  return rows.map((row) => ({
    ...row,
    // Every writer goes through insertNotifications, which only takes these
    // types; anything else in the table is a bug to surface, not to show.
    type: NotificationTypeSchema.parse(row.type),
    // The column defaults to false and no writer sets null.
    read: row.read === true,
    created_at: row.created_at.toISOString(),
  }));
}

/** The caller's newest notifications, for the bell. */
export function listNotificationViewsForUser(
  userId: string,
  limit: number
): Promise<NotificationView[]> {
  return selectViews(eq(notifications.user_id, userId), limit);
}

/** The views of rows just inserted, for their live frames. */
export function listNotificationViewsByIds(ids: string[]): Promise<NotificationView[]> {
  return selectViews(inArray(notifications.id, ids));
}
