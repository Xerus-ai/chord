import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { db } from '@main/db/client';
import { syncQueue } from '@main/db/schema-sync';
import { log } from '@main/lib/logger';
import {
  mergeQueuePayloads,
  WORK_ITEM_CHILD_ENTITIES,
  type SyncEntityType,
  type SyncPayloadByEntity,
} from './sync-queue-entities';
import { queueRowWorkItemId, workItemBelongsToAnotherAccount } from './work-item-account-ownership';

/**
 * Writes to the sync queue table (split from sync-queue-service.ts,
 * devstation-eea): merging an operation into its entity's row, queueing a
 * work item's delete, and dropping what a deleted work item still has queued.
 */

/**
 * Queues one operation, merging it into a pending (or revivable failed) row
 * for the same entity rather than adding a second: every enqueue funnels
 * through here.
 */
export function mergeOrInsertQueueRow<E extends SyncEntityType>(
  entityType: E,
  operation: 'create' | 'update',
  entityId: string,
  payload: SyncPayloadByEntity[E]
): void {
  // Every enqueue path funnels through here: nothing is queued for a work
  // item another account owns. processQueue purges what slipped in before
  // the profile was loaded (getCachedUserId null), so this gate and that
  // purge together are the invariant, not this gate alone.
  const workItemId = queueRowWorkItemId(entityType, entityId, payload as { work_item_id?: string });
  if (
    workItemId !== null &&
    workItemBelongsToAnotherAccount(workItemId, chordAccountService.getCachedUserId())
  ) {
    log.info('[sync-queue] not queued: work item belongs to another account', {
      entityType,
      entityId,
      workItemId,
    });
    return;
  }

  db.transaction((tx) => {
    const pending = tx
      .select()
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.entityType, entityType),
          eq(syncQueue.entityId, entityId),
          eq(syncQueue.status, 'pending')
        )
      )
      .orderBy(desc(syncQueue.id))
      .all();

    const target =
      operation === 'create'
        ? pending.find((row) => row.operation === 'create')
        : (pending.find((row) => row.operation === 'create') ??
          pending.find((row) => row.operation === 'update'));

    if (target) {
      const merged = mergeQueuePayloads(
        entityType,
        JSON.parse(target.payload) as SyncPayloadByEntity[E],
        payload
      );
      tx.update(syncQueue)
        .set({ payload: JSON.stringify(merged) })
        .where(eq(syncQueue.id, target.id))
        .run();
      return;
    }

    // A WORK_ITEM_CHILD_ENTITIES row that got failed out of the parent-
    // missing 404 loop (see processRow) still represents real local data.
    // New activity for the same work item revives that row in place —
    // merging the payload and resetting status/retryCount/orphan clock —
    // rather than inserting a second queue row for the same entity, which
    // would violate the "one row per work item" invariant these entities
    // rely on (see enqueueChatMessages/enqueueGitState) and leave stale
    // failed data sitting inert until an unrelated retry-all revived it.
    // A failed CREATE of any entity is revived the same way: the startup
    // reconcile re-enqueues every local work item the cloud listing lacks,
    // so one that can never be created (its id belongs to another creator)
    // used to gain a fresh failed row per launch — 132 rows for 13 items.
    const revivable = WORK_ITEM_CHILD_ENTITIES.has(entityType) || operation === 'create';
    if (revivable) {
      const failedRow = tx
        .select()
        .from(syncQueue)
        .where(
          and(
            eq(syncQueue.entityType, entityType),
            eq(syncQueue.entityId, entityId),
            eq(syncQueue.status, 'failed'),
            WORK_ITEM_CHILD_ENTITIES.has(entityType)
              ? undefined
              : eq(syncQueue.operation, operation)
          )
        )
        .orderBy(desc(syncQueue.id))
        .get();

      if (failedRow) {
        const merged = mergeQueuePayloads(
          entityType,
          JSON.parse(failedRow.payload) as SyncPayloadByEntity[E],
          payload
        );
        tx.update(syncQueue)
          .set({
            payload: JSON.stringify(merged),
            status: 'pending',
            retryCount: 0,
            errorMessage: null,
            lastAttemptedAt: null,
            firstOrphanedAt: null,
          })
          .where(eq(syncQueue.id, failedRow.id))
          .run();
        return;
      }
    }

    tx.insert(syncQueue)
      .values({ entityType, operation, entityId, payload: JSON.stringify(payload) })
      .run();
  });
}

/**
 * Queues a work item's cloud delete: drops what is still queued for it, and
 * queues nothing when its create never reached the cloud.
 */
export function insertWorkItemDeleteRow(entityId: string): void {
  db.transaction((tx) => {
    const pending = tx
      .select()
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.entityType, 'work_item'),
          eq(syncQueue.entityId, entityId),
          eq(syncQueue.status, 'pending')
        )
      )
      .all();

    const supersededIds = pending
      .filter((row) => row.operation === 'create' || row.operation === 'update')
      .map((row) => row.id);
    if (supersededIds.length > 0) {
      tx.delete(syncQueue).where(inArray(syncQueue.id, supersededIds)).run();
    }

    // Child ops (chat bulk, git state) of a deleted item would 404 forever
    // as noise in the failed-ops list — the parent is gone, not "not yet
    // there", so the child-entity requeue policy must never see them.
    purgeChildOperations(tx, entityId);

    // A pending create means the item never reached the cloud, so there is
    // nothing to delete there — dropping the superseded rows is sufficient.
    if (pending.some((row) => row.operation === 'create')) return;
    if (pending.some((row) => row.operation === 'delete')) return;

    tx.insert(syncQueue)
      .values({ entityType: 'work_item', operation: 'delete', entityId, payload: '{}' })
      .run();
  });
}

/** Drops queued child ops for a work item that is being (or was) deleted. */
export function purgeChildOperations(tx: Pick<typeof db, 'delete'>, workItemId: string): void {
  tx.delete(syncQueue)
    .where(
      or(
        and(
          inArray(syncQueue.entityType, [...WORK_ITEM_CHILD_ENTITIES]),
          eq(syncQueue.entityId, workItemId)
        ),
        // permission_request rows are keyed by requestId, not workItemId —
        // match them through the work_item_id every payload carries.
        and(
          eq(syncQueue.entityType, 'permission_request'),
          sql`json_extract(${syncQueue.payload}, '$.work_item_id') = ${workItemId}`
        ),
        and(
          eq(syncQueue.entityType, 'plan_request'),
          sql`json_extract(${syncQueue.payload}, '$.work_item_id') = ${workItemId}`
        ),
        // artifact rows are keyed by artifactId, not workItemId — match
        // them through the work_item_id their payload carries, same as the
        // request entities above.
        and(
          inArray(syncQueue.entityType, [
            'artifact',
            'artifact_version_upload',
            'artifact_comment_import',
          ]),
          sql`json_extract(${syncQueue.payload}, '$.work_item_id') = ${workItemId}`
        )
      )
    )
    .run();
}

/** Queues the import of device comments an artifact still holds (devstation-85y). */
export function queueArtifactCommentImport(workItemId: string, artifactId: string): void {
  mergeOrInsertQueueRow('artifact_comment_import', 'create', artifactId, {
    work_item_id: workItemId,
    artifact_id: artifactId,
  });
}
