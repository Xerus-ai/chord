import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';

/**
 * "Tell me when this lane is ready" — for work that must not start early,
 * like an agent's first turn arriving while the checkout is still being
 * created or its setup script is still installing dependencies.
 *
 * Readiness is always re-read from the database: whoever changes a lane's
 * state (provisioning, setup) calls `notifyLaneChanged`, and each waiter
 * re-checks its own condition. A failed setup is not "ready" — waiters keep
 * waiting through a Retry until it succeeds, or until the lane goes away.
 */

export type LaneReadiness = 'checkout' | 'setup';

export class LaneWaitCancelledError extends Error {
  constructor(laneId: string, reason: string) {
    super(`Stopped waiting for lane ${laneId}: ${reason}`);
    this.name = 'LaneWaitCancelledError';
  }
}

type Waiter = { until: LaneReadiness; resolve: () => void; reject: (e: Error) => void };

const waiters = new Map<string, Set<Waiter>>();

function isReady(laneId: string, until: LaneReadiness): boolean {
  const [row] = db
    .select({ setupStatus: workItemWorktrees.setupStatus, provision: workItems.provisionStatus })
    .from(workItemWorktrees)
    .innerJoin(workItems, eq(workItems.id, workItemWorktrees.workItemId))
    .where(eq(workItemWorktrees.id, laneId))
    .limit(1)
    .all();
  if (!row) return false;
  if (row.provision !== 'ready') return false;
  if (until === 'checkout') return true;
  // Null: a lane from before setup was tracked — nothing to wait for.
  // Skipped: the user chose Don't run; agents start without it.
  return row.setupStatus === null || row.setupStatus === 'ok' || row.setupStatus === 'skipped';
}

export function waitForLane(laneId: string, until: LaneReadiness): Promise<void> {
  if (isReady(laneId, until)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const set = waiters.get(laneId) ?? new Set<Waiter>();
    set.add({ until, resolve, reject });
    waiters.set(laneId, set);
  });
}

/** Re-checks every waiter on `laneId` against the lane's current state. */
export function notifyLaneChanged(laneId: string): void {
  const set = waiters.get(laneId);
  if (!set) return;
  for (const waiter of [...set]) {
    if (!isReady(laneId, waiter.until)) continue;
    set.delete(waiter);
    waiter.resolve();
  }
  if (set.size === 0) waiters.delete(laneId);
}

/** The lane is going away (deleted, archived): nothing it gates will ever run. */
export function cancelLaneWaiters(laneId: string, reason: string): void {
  const set = waiters.get(laneId);
  if (!set) return;
  waiters.delete(laneId);
  for (const waiter of set) waiter.reject(new LaneWaitCancelledError(laneId, reason));
}
