import { count, eq } from 'drizzle-orm';
import { serverTraffic } from '@main/core/app/server-traffic';
import { db } from '@main/db/client';
import { syncQueue } from '@main/db/schema-sync';
import { selectEligibleSyncRows } from './sync-queue-eligible-rows';
import { syncQueueHealth } from './sync-queue-health';
import { processSyncRow } from './sync-queue-process-row';
import { sendSyncOperation } from './sync-queue-send';

/** One drain cycle of the sync queue (split from sync-queue-service.ts). */

const BATCH_SIZE = 50;
const MAX_DRAIN_PASSES = 4;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Sends the eligible rows, pass after pass while they deliver, and stamps the
 * health heartbeat on progress or a verifiably empty queue.
 * `enqueueCommentImport` queues the device comments a synced artifact still holds.
 */
export async function drainEligibleRows(
  orgId: string | null,
  enqueueCommentImport: (workItemId: string, artifactId: string) => void
): Promise<void> {
  // A row held back behind another in this cycle (a version upload behind
  // its artifact's create) becomes eligible once that one is delivered, so
  // passes repeat while they deliver — bounded, so a steady stream of new
  // rows cannot keep one cycle running.
  let delivered = false;
  for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
    const rows = selectEligibleSyncRows(orgId, BATCH_SIZE);
    let deliveredThisPass = false;
    let stopped = false;
    for (const row of rows) {
      // A verdict mid-cycle: the row stays pending, unclaimed, its retries unspent.
      stopped = !serverTraffic.isOpen();
      if (stopped) break;
      const outcome = await processSyncRow(row, (claimed) =>
        sendSyncOperation(claimed, orgId, enqueueCommentImport)
      );
      if (outcome.delivered) deliveredThisPass = true;
      if (!outcome.proceed) {
        stopped = true;
        break;
      }
    }
    delivered ||= deliveredThisPass;
    if (stopped || !deliveredThisPass) break;
  }

  // Heartbeat: real progress, or the queue verifiably has nothing waiting.
  if (!delivered) {
    const remaining = db
      .select({ n: count() })
      .from(syncQueue)
      .where(eq(syncQueue.status, 'pending'))
      .get();
    if ((remaining?.n ?? 0) > 0) return;
  }
  await syncQueueHealth.recordDrainSuccess(nowSeconds());
}
