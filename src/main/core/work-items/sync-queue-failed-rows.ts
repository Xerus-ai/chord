import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { syncQueue } from '@main/db/schema-sync';
import { QUEUE_ROW_WORK_ITEM_ID_SQL } from './work-item-account-ownership';

/**
 * One failed create row per entity. Builds before devstation-as2 inserted a
 * fresh work-item create on every startup reconcile once the previous one
 * had failed (mergeOrInsert only merged into PENDING rows), so a single
 * unsyncable item stacked one failed row per launch — 132 rows for 13 items
 * in the field. mergeOrInsert now revives the failed row in place; this
 * removes the stacks those builds left behind, keeping the newest row of
 * each (its payload is the most recent snapshot). Runs at startup, idempotent.
 */
export function collapseDuplicateFailedCreates(): number {
  const result = db.run(sql`
    DELETE FROM ${syncQueue}
    WHERE ${syncQueue.status} = 'failed'
      AND ${syncQueue.operation} = 'create'
      AND ${syncQueue.id} NOT IN (
        SELECT MAX(newest.id) FROM sync_queue AS newest
        WHERE newest.status = 'failed' AND newest.operation = 'create'
        GROUP BY newest.entity_type, newest.entity_id
      )
  `);
  return Number(result.changes);
}

/**
 * Builds before devstation-as2 failed a work-item create the server answered
 * 409 (the id is another creator's). This build settles that answer instead:
 * the item is marked another account's and everything queued for it is
 * dropped (sync-queue-service.ts). The old verdicts, and the failed rows of
 * the same items, would read as failures on the first launch after upgrading
 * until the reconcile that follows sign-in re-sent them. Back to pending with
 * a fresh budget, the first drain settles them: the create goes first (its
 * children wait for it, sync-queue-eligible-rows.ts) and takes the rest with
 * it. Runs at startup; a no-op once they have settled.
 */
export function reviveCreatesFailedOnConflict(): number {
  return db.transaction((tx) => {
    const conflicted = tx
      .select({ workItemId: syncQueue.entityId })
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.entityType, 'work_item'),
          eq(syncQueue.operation, 'create'),
          eq(syncQueue.status, 'failed'),
          like(syncQueue.errorMessage, 'HTTP 409:%')
        )
      )
      .all()
      .map((row) => row.workItemId);
    if (conflicted.length === 0) return 0;

    const result = tx
      .update(syncQueue)
      .set({
        status: 'pending',
        retryCount: 0,
        errorMessage: null,
        lastAttemptedAt: null,
        firstOrphanedAt: null,
      })
      .where(and(eq(syncQueue.status, 'failed'), inArray(QUEUE_ROW_WORK_ITEM_ID_SQL, conflicted)))
      .run();
    return Number(result.changes);
  });
}
