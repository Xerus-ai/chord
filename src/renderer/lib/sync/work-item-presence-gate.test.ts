import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearWorkItemPresenceGate,
  parkWorkItemPresence,
  shouldFetchWorkItemPresence,
} from '@renderer/lib/sync/work-item-presence-gate';

describe('work item presence gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    clearWorkItemPresenceGate('wi-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches freely for a work item that has never 404d', () => {
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(true);
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(true);
  });

  it('parks every trigger that fires inside the backoff window', () => {
    parkWorkItemPresence('wi-1');

    expect(shouldFetchWorkItemPresence('wi-1')).toBe(false);
    vi.advanceTimersByTime(4_999);
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(true);
  });

  it('doubles the window on each successive miss', () => {
    parkWorkItemPresence('wi-1');
    vi.advanceTimersByTime(5_000);
    parkWorkItemPresence('wi-1');

    vi.advanceTimersByTime(5_000);
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(true);
  });

  it('caps the window so a long-unsynced work item still retries', () => {
    for (let i = 0; i < 20; i++) parkWorkItemPresence('wi-1');

    vi.advanceTimersByTime(5 * 60 * 1_000);
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(true);
  });

  it('resumes immediately once the cloud row is confirmed', () => {
    parkWorkItemPresence('wi-1');
    expect(shouldFetchWorkItemPresence('wi-1')).toBe(false);

    clearWorkItemPresenceGate('wi-1');

    expect(shouldFetchWorkItemPresence('wi-1')).toBe(true);
  });

  it('keeps the backoff per work item', () => {
    parkWorkItemPresence('wi-1');

    expect(shouldFetchWorkItemPresence('wi-1')).toBe(false);
    expect(shouldFetchWorkItemPresence('wi-2')).toBe(true);
  });
});
