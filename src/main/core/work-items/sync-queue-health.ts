import { count, eq, min } from 'drizzle-orm';
import { serverTraffic } from '@main/core/app/server-traffic';
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
  /** True while the sync server has turned this version away: nothing drains. */
  pausedForVersion: boolean;
  /**
   * Unix seconds of the last time traffic reopened after a pause, null if it
   * never paused in this process: staleness counts from the later of this and
   * lastSuccessfulDrainAt, so a pause is never read as a stalled drain.
   */
  resumedAt: number | null;
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
  private resumedAt: number | null = null;

  setOrgResolution(resolved: boolean): void {
    this.orgUnresolved = !resolved;
  }

  recordResume(atSeconds: number): void {
    this.resumedAt = atSeconds;
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
      pausedForVersion: !serverTraffic.isOpen(),
      resumedAt: this.resumedAt,
    };
  }
}

export const syncQueueHealth = new SyncQueueHealthTracker();
