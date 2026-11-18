import { serverTraffic } from '@main/core/app/server-traffic';
import { log } from '@main/lib/logger';

export type Reconcile = 'workItems' | 'artifacts' | 'chatMessages';

const ORDER: Reconcile[] = ['workItems', 'artifacts', 'chatMessages'];

/**
 * Reconciles asked for while server traffic was closed, run when it opens: a
 * sign-in during the pause would otherwise never reconcile. One that throws
 * is logged and does not stop the others or the drain that follows.
 */
export class OwedReconciles {
  private readonly owed = new Set<Reconcile>();

  constructor(
    private readonly run: Record<Reconcile, () => Promise<void>>,
    /** After the owed ones ran: rows queued while closed wait for a drain. */
    private readonly afterRun: () => void
  ) {}

  /** True when traffic is closed: the reconcile is owed and the caller skips it. */
  owe(reconcile: Reconcile): boolean {
    if (serverTraffic.isOpen()) return false;
    this.owed.add(reconcile);
    return true;
  }

  async runOwed(): Promise<void> {
    const due = ORDER.filter((reconcile) => this.owed.has(reconcile));
    this.owed.clear();
    try {
      for (const reconcile of due) {
        try {
          await this.run[reconcile]();
        } catch (error) {
          log.error('[sync-queue] owed reconcile failed', { reconcile, error: String(error) });
        }
      }
    } finally {
      this.afterRun();
    }
  }
}
