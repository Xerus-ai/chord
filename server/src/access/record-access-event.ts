import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { accessEvents } from '../db/schema-sharing.js';

export type AccessEventAction =
  | 'member_added'
  | 'member_role_changed'
  | 'member_removed'
  | 'general_access_changed'
  | 'link_created'
  | 'link_revoked'
  | 'link_comments_changed'
  | 'link_opened'
  | 'artifact_deleted';

export interface AccessEvent {
  workItemId: string;
  artifactId: string | null;
  actorId: string | null;
  action: AccessEventAction;
  subjectUserId?: string | null;
  subjectEmail?: string | null;
  role?: string | null;
}

/** Appends one audit row (access_events). Throws on failure — an unaudited grant is a bug. */
export async function recordAccessEvent(event: AccessEvent): Promise<void> {
  await db.insert(accessEvents).values({
    id: randomUUID(),
    work_item_id: event.workItemId,
    artifact_id: event.artifactId,
    actor_id: event.actorId,
    subject_user_id: event.subjectUserId ?? null,
    subject_email: event.subjectEmail ?? null,
    action: event.action,
    role: event.role ?? null,
  });
}
