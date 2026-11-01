import { describe, expect, it } from 'vitest';
import { notifySessionExited, waitForSessionExit } from './session-exit-waiters';

/**
 * Stopping a session only asks its process to go; removing the checkout it
 * ran in has to wait for the exit, or Windows refuses the delete while the
 * process still holds its cwd there. A checkpoint e2e run lost that race by
 * 67 ms and left its worktree on disk.
 */
describe('waitForSessionExit', () => {
  it('resolves true when the session exits', async () => {
    const exited = waitForSessionExit('s-1', 1_000);
    notifySessionExited('s-1');
    await expect(exited).resolves.toBe(true);
  });

  it('resolves false when the session has not exited in time', async () => {
    await expect(waitForSessionExit('s-2', 20)).resolves.toBe(false);
  });

  it('wakes every waiter of a session, and no other', async () => {
    const first = waitForSessionExit('s-3', 1_000);
    const second = waitForSessionExit('s-3', 1_000);
    const other = waitForSessionExit('s-4', 50);
    notifySessionExited('s-3');
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await expect(other).resolves.toBe(false);
  });

  it('ignores an exit no one waits for', () => {
    expect(() => notifySessionExited('s-5')).not.toThrow();
  });
});
