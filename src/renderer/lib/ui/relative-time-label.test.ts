import { describe, expect, it } from 'vitest';
import { relativeTimeLabel } from './relative-time-label';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms);

/**
 * devstation-2f3: the sidebar hover card read "now ago" and the rail
 * "0 seconds ago". Under a minute is "just now" wherever a sentence is being
 * read; the bare compact form (a row's meta column) stays "now".
 */
describe('relativeTimeLabel', () => {
  it('says "just now" under a minute, never "now ago" or "0 seconds ago"', () => {
    expect(relativeTimeLabel(ago(10_000), { compact: true, ago: true }, NOW)).toEqual({
      value: 'just now',
      suffix: null,
    });
    expect(relativeTimeLabel(ago(0), {}, NOW)).toEqual({ value: 'just now', suffix: null });
    expect(relativeTimeLabel(ago(59_000), {}, NOW)).toEqual({ value: 'just now', suffix: null });
  });

  it('keeps the bare compact form "now" for a meta column', () => {
    expect(relativeTimeLabel(ago(10_000), { compact: true }, NOW)).toEqual({
      value: 'now',
      suffix: null,
    });
  });

  it('abbreviates past a minute, with "ago" only where asked', () => {
    expect(relativeTimeLabel(ago(5 * 60_000), { compact: true }, NOW)).toEqual({
      value: '5m',
      suffix: null,
    });
    expect(relativeTimeLabel(ago(5 * 60_000), { compact: true, ago: true }, NOW)).toEqual({
      value: '5m',
      suffix: ' ago',
    });
    expect(relativeTimeLabel(ago(3 * 86_400_000), { compact: true }, NOW).value).toBe('3d');
  });

  it('spells the full form out', () => {
    expect(relativeTimeLabel(ago(5 * 60_000), {}, NOW)).toEqual({
      value: '5 minutes ago',
      suffix: null,
    });
  });
});
