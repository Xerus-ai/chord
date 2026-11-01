import { eq, sql } from 'drizzle-orm';
import { isOwnedByAnotherAccount, OWNED_BY_ANOTHER_ACCOUNT } from '@shared/work-item-ownership';
import { db } from '@main/db/client';
import { syncQueue } from '@main/db/schema-sync';
import { workItems } from '@main/db/schema-work-items';

/**
 * The database side of work-item account ownership (shared/work-item-
 * ownership.ts has the rule): which queue rows belong to which work item,
 * and the two writes sync makes — dropping another account's queued
 * operations, and marking a row the server attributed to someone else.
 */

export function workItemBelongsToAnotherAccount(
  workItemId: string,
  currentUserId: string | null
): boolean {
  const row = db
    .select({ ownerAccountId: workItems.ownerAccountId })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .get();
  // A row that no longer exists is not another account's: its queued delete
  // must still reach the cloud.
  if (!row) return false;
  return isOwnedByAnotherAccount(row.ownerAccountId, currentUserId);
}

// Work items and the one-row-per-item child entities are keyed by the work
// item id; artifacts, version uploads and agent requests are keyed by their
// own id and carry `work_item_id` in the payload (the same split
// purgeChildOperations relies on).
const KEYED_BY_WORK_ITEM_ID = [
  'work_item',
  'chat_message_bulk',
  'git_state',
  'worktrees',
  'sessions',
];

export const QUEUE_ROW_WORK_ITEM_ID_SQL = sql`CASE
  WHEN ${syncQueue.entityType} IN ('work_item', 'chat_message_bulk', 'git_state', 'worktrees', 'sessions')
    THEN ${syncQueue.entityId}
  ELSE json_extract(${syncQueue.payload}, '$.work_item_id')
END`;

/** The work item a queue row belongs to. */
export function queueRowWorkItemId(
  entityType: string,
  entityId: string,
  payload: { work_item_id?: string }
): string | null {
  if (KEYED_BY_WORK_ITEM_ID.includes(entityType)) return entityId;
  return payload.work_item_id ?? null;
}

/**
 * Drops every queued operation for a work item another account owns. Runs at
 * the top of each drain cycle: rows queued before the account changed, or
 * while the profile was not yet loaded, are never sent for the wrong account.
 * The local data they carried stays; the owning account's next reconcile
 * re-queues what is still unsynced.
 */
export function purgeOperationsOwnedByAnotherAccount(currentUserId: string): number {
  const result = db.run(sql`
    DELETE FROM ${syncQueue}
    WHERE (${QUEUE_ROW_WORK_ITEM_ID_SQL}) IN (
      SELECT ${workItems.id} FROM ${workItems}
      WHERE ${workItems.ownerAccountId} IS NOT NULL
        AND ${workItems.ownerAccountId} != ${currentUserId}
    )
  `);
  return Number(result.changes);
}

/** Marks a row as another account's and drops everything queued for it. */
export function markWorkItemOwnedByAnotherAccount(workItemId: string): void {
  db.transaction((tx) => {
    tx.update(workItems)
      .set({ ownerAccountId: OWNED_BY_ANOTHER_ACCOUNT })
      .where(eq(workItems.id, workItemId))
      .run();
    tx.run(sql`DELETE FROM ${syncQueue} WHERE (${QUEUE_ROW_WORK_ITEM_ID_SQL}) = ${workItemId}`);
  });
}
