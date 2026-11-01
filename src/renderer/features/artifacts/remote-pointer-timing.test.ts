import { describe, expect, it } from 'vitest';
import {
  EXPIRE_AFTER_MS,
  FADE_AFTER_MS,
  isExpired,
  nextPointerDeadline,
  opacityFor,
} from './remote-pointer-timing';

const NOW = 1_000_000;

describe('nextPointerDeadline', () => {
  it('schedules nothing when nobody is pointing at the document', () => {
    expect(nextPointerDeadline([], NOW)).toBeNull();
  });

  it('wakes at the fade boundary for a pointer that just moved', () => {
    expect(nextPointerDeadline([{ lastMoved: NOW }], NOW)).toBe(NOW + FADE_AFTER_MS);
  });

  it('wakes at the expiry boundary once a pointer is already faded', () => {
    const faded = { lastMoved: NOW - FADE_AFTER_MS - 1 };
    expect(nextPointerDeadline([faded], NOW)).toBe(faded.lastMoved + EXPIRE_AFTER_MS);
  });

  it('schedules nothing more once every pointer is past expiry', () => {
    const stale = { lastMoved: NOW - EXPIRE_AFTER_MS - 1 };
    expect(nextPointerDeadline([stale], NOW)).toBeNull();
  });

  it('takes the earliest deadline across several pointers', () => {
    const older = { lastMoved: NOW - FADE_AFTER_MS - 500 };
    const newer = { lastMoved: NOW };
    // The older pointer expires before the newer one has even faded.
    expect(nextPointerDeadline([newer, older], NOW)).toBe(older.lastMoved + EXPIRE_AFTER_MS);
  });

  it('ignores deadlines that have already passed', () => {
    const pointer = { lastMoved: NOW - FADE_AFTER_MS - 1 };
    const deadline = nextPointerDeadline([pointer], NOW);
    expect(deadline).not.toBeNull();
    expect(deadline!).toBeGreaterThan(NOW);
  });
});

describe('pointer age predicates', () => {
  it('holds a pointer at full opacity until the fade boundary', () => {
    expect(opacityFor({ lastMoved: NOW - FADE_AFTER_MS }, NOW)).toBe(1);
    expect(opacityFor({ lastMoved: NOW - FADE_AFTER_MS - 1 }, NOW)).toBe(0.3);
  });

  it('expires a pointer only after the expiry window has fully elapsed', () => {
    expect(isExpired({ lastMoved: NOW - EXPIRE_AFTER_MS }, NOW)).toBe(false);
    expect(isExpired({ lastMoved: NOW - EXPIRE_AFTER_MS - 1 }, NOW)).toBe(true);
  });
});
