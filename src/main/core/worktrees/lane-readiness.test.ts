import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import {
  cancelLaneWaiters,
  LaneWaitCancelledError,
  notifyLaneChanged,
  waitForLane,
} from './lane-readiness';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const ITEM = 'item-1';
const LANE = 'lane-1';

function setItem(provisionStatus: string): void {
  db.update(workItems).set({ provisionStatus }).where(eq(workItems.id, ITEM)).run();
}

function setLane(setupStatus: string | null): void {
  db.update(workItemWorktrees).set({ setupStatus }).where(eq(workItemWorktrees.id, LANE)).run();
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true)
  );
  await new Promise((r) => setTimeout(r, 20));
  return done;
}

describe('waitForLane', () => {
  beforeEach(() => {
    db.insert(workItems)
      .values({ id: ITEM, name: 'item', repoPath: '/repo', provisionStatus: 'provisioning' })
      .run();
    db.insert(workItemWorktrees)
      .values({ id: LANE, workItemId: ITEM, path: '/repo', isPrimary: 1, setupStatus: 'pending' })
      .run();
  });

  afterEach(() => {
    db.delete(workItems).run();
  });

  it('holds a checkout wait until provisioning lands, then releases it', async () => {
    const waiting = waitForLane(LANE, 'checkout');
    expect(await settled(waiting)).toBe(false);

    setItem('ready');
    notifyLaneChanged(LANE);

    await expect(waiting).resolves.toBeUndefined();
  });

  it('holds a setup wait through provisioning and a running setup', async () => {
    const waiting = waitForLane(LANE, 'setup');

    setItem('ready');
    notifyLaneChanged(LANE);
    expect(await settled(waiting)).toBe(false);

    setLane('running');
    notifyLaneChanged(LANE);
    expect(await settled(waiting)).toBe(false);

    setLane('ok');
    notifyLaneChanged(LANE);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('keeps holding after a failed setup, until a retry succeeds', async () => {
    setItem('ready');
    const waiting = waitForLane(LANE, 'setup');

    setLane('failed');
    notifyLaneChanged(LANE);
    expect(await settled(waiting)).toBe(false);

    setLane('ok');
    notifyLaneChanged(LANE);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('resolves at once for a lane that is already ready', async () => {
    setItem('ready');
    setLane('ok');
    await expect(waitForLane(LANE, 'setup')).resolves.toBeUndefined();
  });

  it("releases a setup wait when the user chose Don't run", async () => {
    setItem('ready');
    const waiting = waitForLane(LANE, 'setup');

    setLane('skipped');
    notifyLaneChanged(LANE);

    await expect(waiting).resolves.toBeUndefined();
  });

  it('does not wait on a lane whose setup is not tracked', async () => {
    setItem('ready');
    setLane(null);
    await expect(waitForLane(LANE, 'setup')).resolves.toBeUndefined();
  });

  it('rejects waiters when the lane goes away', async () => {
    const waiting = waitForLane(LANE, 'setup');

    cancelLaneWaiters(LANE, 'work item deleted');

    await expect(waiting).rejects.toBeInstanceOf(LaneWaitCancelledError);
  });
});
