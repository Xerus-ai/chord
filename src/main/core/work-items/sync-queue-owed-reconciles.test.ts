import { afterEach, describe, expect, it } from 'vitest';
import { serverTraffic } from '@main/core/app/server-traffic';
import { OwedReconciles, type Reconcile } from './sync-queue-owed-reconciles';

/**
 * The reconciles a paused app owes, run when traffic reopens. The bug this
 * catches: one owed reconcile that throws skipped the ones after it, dropped
 * them from the owed set and skipped the drain of rows queued while paused,
 * leaving an unhandled rejection.
 */
const PAUSED = { state: 'update_required', current: '1.0.0', minimum: '2.0.0' } as const;
const OPEN = { state: 'supported', current: '2.0.0', minimum: '2.0.0' } as const;

afterEach(() => serverTraffic.apply(OPEN));

function recorder(throwing: Reconcile | null) {
  const ran: Reconcile[] = [];
  let drains = 0;
  const step = (reconcile: Reconcile) => async () => {
    if (reconcile === throwing) throw new Error(`${reconcile} failed`);
    ran.push(reconcile);
  };
  const owed = new OwedReconciles(
    {
      workItems: step('workItems'),
      artifacts: step('artifacts'),
      chatMessages: step('chatMessages'),
    },
    () => {
      drains += 1;
    }
  );
  return { owed, ran, drains: () => drains };
}

describe('owed reconciles', () => {
  it('one that throws does not stop the others or the drain', async () => {
    serverTraffic.apply(PAUSED);
    const { owed, ran, drains } = recorder('workItems');
    expect(owed.owe('chatMessages')).toBe(true);
    expect(owed.owe('workItems')).toBe(true);
    expect(owed.owe('artifacts')).toBe(true);

    serverTraffic.apply(OPEN);
    await expect(owed.runOwed()).resolves.toBeUndefined();
    expect(ran).toEqual(['artifacts', 'chatMessages']);
    expect(drains()).toBe(1);

    // Paid: a second opening runs none of them again.
    await owed.runOwed();
    expect(ran).toEqual(['artifacts', 'chatMessages']);
  });

  it('nothing is owed while traffic is open', async () => {
    const { owed, ran } = recorder(null);
    expect(owed.owe('workItems')).toBe(false);
    await owed.runOwed();
    expect(ran).toEqual([]);
  });
});
