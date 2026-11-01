import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { syncQueue, type SyncQueueRow } from '@main/db/schema-sync';
import { log } from '@main/lib/logger';
import type { SendResult } from './cloud-work-items-client';
import { WORK_ITEM_CHILD_ENTITIES, type SyncEntityType } from './sync-queue-entities';
import { NonRetryableSyncError } from './sync-queue-send';
import { purgeChildOperations } from './sync-queue-writes';

/**
 * One sync-queue row through a drain (split from sync-queue-service.ts,
 * devstation-eea).
 */

const MAX_RETRIES = 5;
const ERROR_MESSAGE_MAX_LENGTH = 1000;
// Wall-clock bound on the "parent work item missing" 404 requeue loop for
// WORK_ITEM_CHILD_ENTITIES. Deliberately generous (hours, not MAX_RETRIES):
// a transient parent (still pending, mid-backoff, offline client) resolves
// within minutes; this only fires once the parent has been unreachable or
// permanently failed for a long time, so a real parent-create outage doesn't
// fail children out from under the user.
const ORPHAN_GRACE_PERIOD_SECONDS = 6 * 60 * 60;
const ORPHAN_ERROR_MESSAGE =
  'Parent work item never reached the cloud (create failed or the item was deleted); this operation could not be delivered.';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Claims one selected row, sends it (`send`), and records the outcome:
 * delivered rows are deleted; a parent-missing 404 waits (bounded by wall
 * clock); everything else retries with a bounded count, or fails out.
 * `proceed: false` stops the drain cycle (a transient network failure).
 */
export async function processSyncRow(
  selected: SyncQueueRow,
  send: (row: SyncQueueRow) => Promise<SendResult>
): Promise<{ proceed: boolean; delivered: boolean }> {
  // Claim the row and read it back in one statement: the pass selected it
  // earlier, and a payload merged into it since (mergeOrInsert merges into
  // pending rows) must be what is sent — the row is deleted once it is
  // delivered (devstation-83y). From here a merge lands in a new row. A row
  // purged since it was selected is simply gone.
  const row = db
    .update(syncQueue)
    .set({ status: 'processing' })
    .where(and(eq(syncQueue.id, selected.id), eq(syncQueue.status, 'pending')))
    .returning()
    .get();
  if (!row) return { proceed: true, delivered: false };

  let result: SendResult;
  try {
    result = await send(row);
  } catch (error) {
    // A row that can never succeed — an unsupported operation, or a payload
    // this client serialized wrong so JSON.parse throws — must fail-out,
    // bounded and surfaced, NOT revert to pending. A bare revert leaves
    // lastAttemptedAt NULL, so the row stays first-eligible and re-throws
    // every cycle, wedging the whole queue behind it (head-of-line block).
    if (error instanceof NonRetryableSyncError || error instanceof SyntaxError) {
      db.update(syncQueue)
        .set({
          status: 'failed',
          retryCount: row.retryCount + 1,
          lastAttemptedAt: nowSeconds(),
          errorMessage: String(error).slice(0, ERROR_MESSAGE_MAX_LENGTH),
        })
        .where(eq(syncQueue.id, row.id))
        .run();
      log.error('[sync-queue] non-retryable operation failed permanently', {
        id: row.id,
        operation: row.operation,
        entityType: row.entityType,
        entityId: row.entityId,
        error: String(error),
      });
      return { proceed: true, delivered: false };
    }

    // Transient network/timeout failure: revert without consuming a retry and
    // stop the cycle so the whole batch is retried once connectivity returns.
    db.update(syncQueue).set({ status: 'pending' }).where(eq(syncQueue.id, row.id)).run();
    log.warn('[sync-queue] transient send failure, deferring batch', {
      id: row.id,
      operation: row.operation,
      entityId: row.entityId,
      error: String(error),
    });
    return { proceed: false, delivered: false };
  }

  if (result.ok) {
    db.delete(syncQueue).where(eq(syncQueue.id, row.id)).run();
    // A confirmed remote delete also purges child ops that slipped in
    // between the local delete and this drain (e.g. a racing capture tick).
    if (row.entityType === 'work_item' && row.operation === 'delete') {
      purgeChildOperations(db, row.entityId);
    }
    return { proceed: true, delivered: true };
  }

  if (result.status === 404 && WORK_ITEM_CHILD_ENTITIES.has(row.entityType as SyncEntityType)) {
    // Parent work item not on the cloud yet: requeue without consuming a
    // retry. A child never drains while its parent's create is queued
    // (sync-queue-eligible-rows.ts), so this resolves once it lands — UNLESS the
    // parent create permanently failed (hit MAX_RETRIES, e.g. validation
    // error) or the item was deleted cloud-side, in which case it never
    // reappears in the pending queue and this would requeue forever,
    // invisibly (never reaching 'failed', so never surfaced to the user).
    // Bound the streak by wall clock instead of retry count, since these
    // requeues intentionally don't consume MAX_RETRIES.
    const now = nowSeconds();
    const orphanedSince = row.firstOrphanedAt ?? now;
    if (now - orphanedSince >= ORPHAN_GRACE_PERIOD_SECONDS) {
      db.update(syncQueue)
        .set({
          status: 'failed',
          lastAttemptedAt: now,
          errorMessage: ORPHAN_ERROR_MESSAGE,
        })
        .where(eq(syncQueue.id, row.id))
        .run();
      log.error('[sync-queue] child op orphaned: parent never synced, giving up', {
        id: row.id,
        entityId: row.entityId,
        entityType: row.entityType,
        orphanedForSeconds: now - orphanedSince,
      });
      return { proceed: true, delivered: false };
    }

    db.update(syncQueue)
      .set({ status: 'pending', lastAttemptedAt: now, firstOrphanedAt: orphanedSince })
      .where(eq(syncQueue.id, row.id))
      .run();
    log.info('[sync-queue] parent work item missing, child op deferred', {
      id: row.id,
      entityId: row.entityId,
      entityType: row.entityType,
      orphanedForSeconds: now - orphanedSince,
    });
    return { proceed: true, delivered: false };
  }

  if (result.terminal) {
    // Set by sendWorkItemUpdate on a double CAS conflict: retrying with
    // backoff can't fix "another writer keeps beating us," and blindly
    // continuing to MAX_RETRIES would eventually fall through to the same
    // generic 'failed' outcome anyway but only after several needless
    // rounds — fail now, with a message that says what actually happened
    // instead of a generic HTTP-status one.
    db.update(syncQueue)
      .set({
        status: 'failed',
        retryCount: row.retryCount + 1,
        lastAttemptedAt: nowSeconds(),
        errorMessage: result.body.slice(0, ERROR_MESSAGE_MAX_LENGTH),
      })
      .where(eq(syncQueue.id, row.id))
      .run();
    log.error('[sync-queue] operation failed permanently (non-retryable)', {
      id: row.id,
      operation: row.operation,
      entityId: row.entityId,
      status: result.status,
      body: result.body,
    });
    return { proceed: true, delivered: false };
  }

  const retryCount = row.retryCount + 1;
  const errorMessage = `HTTP ${result.status}: ${result.body}`.slice(0, ERROR_MESSAGE_MAX_LENGTH);

  if (retryCount >= MAX_RETRIES) {
    db.update(syncQueue)
      .set({ status: 'failed', retryCount, lastAttemptedAt: nowSeconds(), errorMessage })
      .where(eq(syncQueue.id, row.id))
      .run();
    log.error('[sync-queue] operation permanently failed after max retries', {
      id: row.id,
      operation: row.operation,
      entityId: row.entityId,
      retryCount,
      status: result.status,
      body: result.body,
    });
  } else {
    db.update(syncQueue)
      .set({ status: 'pending', retryCount, lastAttemptedAt: nowSeconds(), errorMessage })
      .where(eq(syncQueue.id, row.id))
      .run();
    log.warn('[sync-queue] operation failed, scheduled for retry', {
      id: row.id,
      operation: row.operation,
      entityId: row.entityId,
      retryCount,
      status: result.status,
    });
  }
  return { proceed: true, delivered: false };
}
