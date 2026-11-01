import { describe, expect, it } from 'vitest';
import {
  contextFill,
  EMPTY_SESSION_TELEMETRY,
  formatTokenCount,
  mapClaudeRateLimitWindows,
  reduceSessionTelemetry,
} from './session-telemetry';

// `rate_limit_info` captured from a real `rate_limit_event` (Claude Code
// 2.1.280, 2026-09-23). `unifiedWindows` is sent on the wire but absent from
// the SDK's type declarations.
const CAPTURED_RATE_LIMIT = {
  status: 'allowed',
  resetsAt: 1790104200,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  overageDisabledReason: 'org_level_disabled',
  isUsingOverage: false,
  unifiedWindows: {
    five_hour: { utilization: 0.38, resetsAt: 1790104200 },
    seven_day: { utilization: 0.42, resetsAt: 1790244000 },
  },
};

describe('mapClaudeRateLimitWindows', () => {
  it('reads every unified window, as percent with reset in epoch ms', () => {
    expect(mapClaudeRateLimitWindows(CAPTURED_RATE_LIMIT)).toEqual([
      { id: 'five_hour', label: '5-hour limit', usedPercent: 38, resetsAt: 1790104200000 },
      { id: 'seven_day', label: 'Weekly limit', usedPercent: 42, resetsAt: 1790244000000 },
    ]);
  });

  it('reads the single documented window when no unified windows are sent', () => {
    expect(
      mapClaudeRateLimitWindows({
        status: 'allowed_warning',
        rateLimitType: 'seven_day_opus',
        utilization: 0.915,
        resetsAt: 1790244000,
      })
    ).toEqual([
      { id: 'seven_day_opus', label: 'Weekly · Opus', usedPercent: 92, resetsAt: 1790244000000 },
    ]);
  });

  it('reports nothing for an event without utilization', () => {
    expect(mapClaudeRateLimitWindows({ status: 'allowed', rateLimitType: 'five_hour' })).toEqual(
      []
    );
  });
});

describe('reduceSessionTelemetry', () => {
  it('records context usage', () => {
    const next = reduceSessionTelemetry(EMPTY_SESSION_TELEMETRY, {
      type: 'context_usage',
      usedTokens: 22246,
      maxTokens: 200000,
    });
    expect(next.context).toEqual({ usedTokens: 22246, maxTokens: 200000 });
  });

  it('records the running session cost from usage events', () => {
    const next = reduceSessionTelemetry(EMPTY_SESSION_TELEMETRY, {
      type: 'usage',
      inputTokens: 10,
      outputTokens: 4,
      totalCostUsd: 0.044687,
    });
    expect(next.costUsd).toBe(0.044687);
  });

  it('merges rate-limit windows by id, newest wins', () => {
    const first = reduceSessionTelemetry(EMPTY_SESSION_TELEMETRY, {
      type: 'rate_limit',
      windows: mapClaudeRateLimitWindows(CAPTURED_RATE_LIMIT),
    });
    const second = reduceSessionTelemetry(first, {
      type: 'rate_limit',
      windows: [{ id: 'five_hour', label: '5-hour limit', usedPercent: 51, resetsAt: 1 }],
    });
    expect(second.windows).toEqual([
      { id: 'five_hour', label: '5-hour limit', usedPercent: 51, resetsAt: 1 },
      { id: 'seven_day', label: 'Weekly limit', usedPercent: 42, resetsAt: 1790244000000 },
    ]);
  });

  it('ignores events that carry no telemetry', () => {
    const next = reduceSessionTelemetry(EMPTY_SESSION_TELEMETRY, { type: 'turn_started' });
    expect(next).toBe(EMPTY_SESSION_TELEMETRY);
  });
});

describe('contextFill', () => {
  it('computes a clamped percentage', () => {
    expect(contextFill({ usedTokens: 22246, maxTokens: 200000 }).percent).toBe(11);
    expect(contextFill({ usedTokens: 250000, maxTokens: 200000 }).percent).toBe(100);
  });

  it('turns warning at 70% and danger past 90%', () => {
    expect(contextFill({ usedTokens: 139000, maxTokens: 200000 }).tone).toBe('normal');
    expect(contextFill({ usedTokens: 140000, maxTokens: 200000 }).tone).toBe('warning');
    expect(contextFill({ usedTokens: 181000, maxTokens: 200000 }).tone).toBe('danger');
  });

  it('throws on a non-positive window rather than dividing by zero', () => {
    expect(() => contextFill({ usedTokens: 10, maxTokens: 0 })).toThrow();
  });
});

describe('formatTokenCount', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(22246)).toBe('22.2k');
    expect(formatTokenCount(200000)).toBe('200k');
    expect(formatTokenCount(1000000)).toBe('1M');
    expect(formatTokenCount(1250000)).toBe('1.3M');
  });
});
