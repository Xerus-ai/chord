import { mapCodexRateLimitWindows } from '@shared/session-telemetry';
import type { UsageWindow } from '@shared/usage-window';
import { CodexAppServerClient } from './app-server-client';
import type { GetAccountRateLimitsResponse } from './protocol/v2/GetAccountRateLimitsResponse';

/** How long a provider's reported windows stand before they are read again. */
const USAGE_REPORT_TTL_MS = 5 * 60_000;

export function isUsageReportFresh(reportedAt: number | null, now: number): boolean {
  return reportedAt !== null && now - reportedAt < USAGE_REPORT_TTL_MS;
}

/**
 * The account's Codex plan windows, read over a short-lived app-server — so
 * the composer can show them before any Codex session has run a turn. Live
 * sessions keep them current afterwards (`account/rateLimits/updated`).
 */
export function readCodexUsageWindows(command: string, cwd: string): Promise<UsageWindow[]> {
  return CodexAppServerClient.runOnce(command, cwd, async (client) => {
    const { rateLimits } =
      await client.request<GetAccountRateLimitsResponse>('account/rateLimits/read');
    return mapCodexRateLimitWindows(rateLimits);
  });
}
