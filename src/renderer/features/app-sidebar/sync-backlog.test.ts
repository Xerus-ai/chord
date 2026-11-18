import { describe, expect, it } from 'vitest';
import { STALE_DRAIN_SECONDS, syncBacklog } from './sync-backlog';

/**
 * What the sidebar's sync badge says about queued operations. The bugs these
 * catch: a pause for a version update shown as a stalled sync, and the time an
 * app spent paused counted against the drain once traffic reopened (the
 * heartbeat is not stamped while paused).
 */
const NOW = 1_800_000_000;
const healthy = {
  pendingCount: 3,
  lastSuccessfulDrainAt: NOW - 60,
  orgUnresolved: false,
  pausedForVersion: false,
  resumedAt: null,
};

describe('sync backlog', () => {
  it('a paused app names the pause, not a stalled sync', () => {
    expect(
      syncBacklog({ ...healthy, pausedForVersion: true, lastSuccessfulDrainAt: NOW - 86_400 }, NOW)
    ).toBe('paused-for-version');
  });

  it('just after a long pause ends, an old heartbeat is not a stall', () => {
    const lastDrain = NOW - 86_400;
    expect(
      syncBacklog({ ...healthy, lastSuccessfulDrainAt: lastDrain, resumedAt: NOW - 30 }, NOW)
    ).toBeNull();
    // ...and still a stall once the drain has made no progress since the resume
    expect(
      syncBacklog(
        { ...healthy, lastSuccessfulDrainAt: lastDrain, resumedAt: NOW - STALE_DRAIN_SECONDS },
        NOW
      )
    ).toBe('stalled');
  });

  it('a stale drain with no pause is a stall; an unresolved org is named', () => {
    const stale = { ...healthy, lastSuccessfulDrainAt: NOW - STALE_DRAIN_SECONDS };
    expect(syncBacklog(stale, NOW)).toBe('stalled');
    expect(syncBacklog({ ...stale, orgUnresolved: true }, NOW)).toBe('org-unresolved');
    expect(syncBacklog({ ...healthy, lastSuccessfulDrainAt: null }, NOW)).toBe('stalled');
    expect(syncBacklog(healthy, NOW)).toBeNull();
    expect(syncBacklog({ ...stale, pendingCount: 0 }, NOW)).toBeNull();
  });
});
