import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isUsageReportFresh, readCodexUsageWindows } from './codex-rate-limits';

describe('isUsageReportFresh', () => {
  const now = 1_790_000_000_000;

  it('keeps a report younger than five minutes', () => {
    expect(isUsageReportFresh(now - 4 * 60_000, now)).toBe(true);
  });

  it('refreshes a report five minutes old or older, or none at all', () => {
    expect(isUsageReportFresh(now - 5 * 60_000, now)).toBe(false);
    expect(isUsageReportFresh(null, now)).toBe(false);
  });
});

// Real CLI, no mocks: asks the installed, signed-in Codex for the account's
// plan windows over a short-lived app-server. No thread is started.
describe('readCodexUsageWindows', () => {
  it('returns the 5-hour and weekly windows', { timeout: 60_000 }, async () => {
    const windows = await readCodexUsageWindows('codex', homedir());

    expect(windows.map((w) => w.id)).toEqual(['five_hour', 'seven_day']);
    for (const w of windows) {
      expect(w.usedPercent).toBeGreaterThanOrEqual(0);
      expect(w.usedPercent).toBeLessThanOrEqual(100);
      expect(w.resetsAt).toBeGreaterThan(Date.now() - 60_000);
    }
  });
});
