import { describe, expect, it } from 'vitest';
import { formatTime } from './chat-message-transform';

/**
 * Every chat row's time label is formatted when the thread loads — 1,280 rows
 * took 54 ms of a 180 ms open while each call built its locale formatter anew
 * (CPU profile, 2026-10-15). The formatters are shared now; the labels must
 * read exactly as the locale formats them.
 */
const secondsOf = (date: Date) => Math.floor(date.getTime() / 1000);

describe('formatTime', () => {
  it('shows only the time for a message sent today', () => {
    const today = new Date();
    today.setHours(9, 5, 0, 0);

    expect(formatTime(secondsOf(today))).toBe(
      today.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    );
  });

  it('adds the month and day for an earlier day this year', () => {
    const now = new Date();
    const earlier = new Date(now.getFullYear(), 0, 1, 16, 30);
    if (earlier.toDateString() === now.toDateString()) earlier.setFullYear(now.getFullYear() - 1);
    const sameYear = earlier.getFullYear() === now.getFullYear();

    const day = earlier.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
    });
    const time = earlier.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(formatTime(secondsOf(earlier))).toBe(`${day}, ${time}`);
  });

  it('adds the year for a message from an earlier year', () => {
    const old = new Date(2024, 6, 14, 23, 59);

    const day = old.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const time = old.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(formatTime(secondsOf(old))).toBe(`${day}, ${time}`);
  });
});
