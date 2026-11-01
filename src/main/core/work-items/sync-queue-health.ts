import { count, eq, min } from 'drizzle-orm';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { syncQueue } from '@main/db/schema-sync';

interface SyncHealthKVSchema extends Record<string, unknown> {
  lastSuccessfulDrainAt: number;
}

const syncHealthKV = new KV<SyncHealthKVSchema>('sync-health');

export interface SyncQueueHealth {
  /** Rows currently waiting to be sent. */
  pendingCount: number;
  /** Unix seconds of the oldest pending row, null when the queue is empty. */
  oldestPendingAt: number | null;
  /**
   * Unix seconds of the last cycle that either delivered an operation or
   * confirmed the queue empty. Null means this install has NEVER drained.
   */
  lastSuccessfulDrainAt: number | null;
  /** True while org resolution answers "no org" — work-item creates are held. */
  orgUnresolved: boolean;
}

/**
 * Sync-health heartbeat (NEW-6 recovery surfacing): a durable
 * last-successful-drain stamp plus live queue depth, so a wedged queue is a
 * renderable state instead of a silence only DB forensics could find. The
 * stamp lives in kv (BridgePointer pattern: durable pointer, refreshed on
 * progress, readable at startup) and survives restarts; org-resolution state
 * is per-process, refreshed every drain cycle.
 */
class SyncQueueHealthTracker {
  private orgUnresolved = false;

  setOrgResolution(resolved: boolean): void {
    this.orgUnresolved = !resolved;
  }

  async recordDrainSuccess(atSeconds: number): Promise<void> {
    await syncHealthKV.set('lastSuccessfulDrainAt', atSeconds);
  }

  async getHealth(): Promise<SyncQueueHealth> {
    const agg = db
      .select({ pending: count(), oldest: min(syncQueue.createdAt) })
      .from(syncQueue)
      .where(eq(syncQueue.status, 'pending'))
      .get();

    return {
      pendingCount: agg?.pending ?? 0,
      oldestPendingAt: agg?.oldest ?? null,
      lastSuccessfulDrainAt: (await syncHealthKV.get('lastSuccessfulDrainAt')) ?? null,
      orgUnresolved: this.orgUnresolved,
    };
  }
}

export const syncQueueHealth = new SyncQueueHealthTracker();
