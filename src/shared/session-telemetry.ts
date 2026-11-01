import type { AgentOutputEvent } from './events/agentOutputEvents';
import type { UsageWindow } from './usage-window';

/**
 * What a live agent session reports about its own consumption: how full the
 * context window is, what the session has cost, and the provider's plan usage
 * windows. Main keeps the latest per session and pushes it to the composer.
 */
export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
}

export interface SessionTelemetry {
  context: ContextUsage | null;
  costUsd: number | null;
  windows: UsageWindow[];
}

export const EMPTY_SESSION_TELEMETRY: SessionTelemetry = {
  context: null,
  costUsd: null,
  windows: [],
};

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  seven_day_overage_included: 'Weekly · incl. extra usage',
  overage: 'Extra usage',
};

function toWindow(id: string, utilization: unknown, resetsAt: unknown): UsageWindow | null {
  if (typeof utilization !== 'number') return null;
  return {
    id,
    label: WINDOW_LABELS[id] ?? id,
    usedPercent: Math.round(utilization * 100),
    resetsAt: typeof resetsAt === 'number' ? resetsAt * 1000 : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Maps the Agent SDK's `rate_limit_info`. The CLI sends every window in
 * `unifiedWindows` (utilization 0–1, reset in epoch seconds) — a field the
 * SDK's type declarations omit — alongside the single documented
 * `rateLimitType`/`utilization` pair, which is read when no unified windows
 * are present.
 */
export function mapClaudeRateLimitWindows(info: unknown): UsageWindow[] {
  if (!isRecord(info)) return [];
  const unified = info.unifiedWindows;
  if (isRecord(unified)) {
    return Object.entries(unified)
      .map(([id, w]) => (isRecord(w) ? toWindow(id, w.utilization, w.resetsAt) : null))
      .filter((w): w is UsageWindow => w !== null);
  }
  if (typeof info.rateLimitType !== 'string') return [];
  const single = toWindow(info.rateLimitType, info.utilization, info.resetsAt);
  return single ? [single] : [];
}

/** A Codex app-server rate-limit window: `usedPercent` 0–100, `resetsAt` in epoch seconds. */
interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

const CODEX_WINDOW_IDS: Record<number, string> = { 300: 'five_hour', 10080: 'seven_day' };

/**
 * Maps a Codex `RateLimitSnapshot`. Codex names its windows only `primary` and
 * `secondary`; their length says which is which, so the ids match Claude's
 * and the popover labels them alike.
 */
export function mapCodexRateLimitWindows(snapshot: {
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
}): UsageWindow[] {
  return [snapshot.primary, snapshot.secondary]
    .filter((w): w is CodexRateLimitWindow => w !== null)
    .map((w) => {
      const id =
        (w.windowDurationMins !== null && CODEX_WINDOW_IDS[w.windowDurationMins]) ||
        `window_${w.windowDurationMins ?? 'unknown'}m`;
      return {
        id,
        label: WINDOW_LABELS[id] ?? id,
        usedPercent: Math.round(w.usedPercent),
        resetsAt: w.resetsAt !== null ? w.resetsAt * 1000 : null,
      };
    });
}

function mergeWindows(prev: UsageWindow[], next: UsageWindow[]): UsageWindow[] {
  const byId = new Map(prev.map((w) => [w.id, w]));
  for (const w of next) byId.set(w.id, w);
  return [...byId.values()];
}

export function reduceSessionTelemetry(
  state: SessionTelemetry,
  event: AgentOutputEvent
): SessionTelemetry {
  switch (event.type) {
    case 'context_usage':
      return { ...state, context: { usedTokens: event.usedTokens, maxTokens: event.maxTokens } };
    case 'usage':
      return event.totalCostUsd === undefined ? state : { ...state, costUsd: event.totalCostUsd };
    case 'rate_limit':
      return { ...state, windows: mergeWindows(state.windows, event.windows) };
    default:
      return state;
  }
}

export type ContextTone = 'normal' | 'warning' | 'danger';

export function contextFill(usage: ContextUsage): { percent: number; tone: ContextTone } {
  if (usage.maxTokens <= 0) {
    throw new Error(`Context window must be positive, got ${usage.maxTokens}`);
  }
  const ratio = usage.usedTokens / usage.maxTokens;
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  // From the raw ratio: 69.5% rounds to 70 but has not reached the threshold.
  const tone: ContextTone = ratio > 0.9 ? 'danger' : ratio >= 0.7 ? 'warning' : 'normal';
  return { percent, tone };
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimFixed(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trimFixed(tokens / 1_000)}k`;
  return String(tokens);
}
