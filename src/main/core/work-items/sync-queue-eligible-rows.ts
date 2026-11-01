import { asc, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { syncQueue, type SyncQueueRow } from '@main/db/schema-sync';

/** Exponential backoff per row: 5 s, 10 s, 20 s … after each failed attempt. */
const BACKOFF_BASE_SECONDS = 5;

/**
 * The rows one drain pass may send, oldest first: pending, and past their
 * backoff.
 *
 * - A version upload or comment import waits while its artifact's create is
 *   still queued: the server can only store either for an artifact it knows. Ascending ids
 *   are not enough — the startup reconcile can re-queue a create after an
 *   upload that was queued first.
 * - Every row that hangs off a work item waits while that item's create is
 *   still queued, for the same reason: sent first it only earns a 404, and a
 *   child whose orphan clock started on an earlier launch is failed out by
 *   that one 404 — a false "N failed" until the parent settles
 *   (devstation-as2).
 * - With no resolvable org, work-item creates (the only org-scoped send) are
 *   held back too; their children then wait by the rule above. Everything
 *   else drains normally.
 */
export function selectEligibleSyncRows(orgId: string | null, limit: number): SyncQueueRow[] {
  const now = Math.floor(Date.now() / 1000);
  const pastBackoff = sql`${syncQueue.status} = 'pending' AND (${syncQueue.lastAttemptedAt} IS NULL OR (${syncQueue.lastAttemptedAt} + (${BACKOFF_BASE_SECONDS} * (1 << ${syncQueue.retryCount}))) <= ${now})`;

  const queuedArtifactCreates = sql`(SELECT a.entity_id FROM sync_queue a WHERE a.entity_type = 'artifact' AND a.operation = 'create' AND a.status IN ('pending', 'processing'))`;
  const queuedParentCreates = sql`(SELECT wi.entity_id FROM sync_queue wi WHERE wi.entity_type = 'work_item' AND wi.operation = 'create' AND wi.status IN ('pending', 'processing'))`;
  const eligible = sql`${pastBackoff}
    AND NOT (${syncQueue.entityType} IN ('artifact_version_upload', 'artifact_comment_import') AND COALESCE(json_extract(${syncQueue.payload}, '$.artifact_id'), '') IN ${queuedArtifactCreates})
    AND NOT (${syncQueue.entityType} IN ('chat_message_bulk', 'git_state', 'worktrees', 'sessions') AND ${syncQueue.entityId} IN ${queuedParentCreates})
    AND NOT (${syncQueue.entityType} IN ('artifact', 'artifact_version_upload', 'artifact_comment_import', 'permission_request', 'plan_request') AND COALESCE(json_extract(${syncQueue.payload}, '$.work_item_id'), '') IN ${queuedParentCreates})`;

  const where =
    orgId === null
      ? sql`${eligible}
          AND NOT (${syncQueue.entityType} = 'work_item' AND ${syncQueue.operation} = 'create')`
      : eligible;

  return db.select().from(syncQueue).where(where).orderBy(asc(syncQueue.id)).limit(limit).all();
}
