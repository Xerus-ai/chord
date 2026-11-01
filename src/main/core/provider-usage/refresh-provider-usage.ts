import { homedir } from 'node:os';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import type { ProviderUsageUpdate } from '@shared/events/sessionTelemetryEvents';
import type { UsageWindow } from '@shared/usage-window';
import { resolveAgentExecutable } from '@main/core/agent-sessions/resolve-agent-executable';
import {
  isUsageReportFresh,
  readCodexUsageWindows,
} from '@main/core/codex-app-server/codex-rate-limits';
import { getProviderUsage, recordProviderUsage } from './provider-usage-store';

/**
 * Providers whose plan windows can be asked for outside a session. Claude has
 * none on purpose: its windows arrive only with a live session's
 * `rate_limit_event`, since reading them ahead of a turn would mean reading
 * the user's stored credentials.
 */
const USAGE_READERS: Partial<Record<AgentProviderId, () => Promise<UsageWindow[]>>> = {
  codex: async () =>
    readCodexUsageWindows(
      await resolveAgentExecutable({ providerId: 'codex', cli: getProvider('codex')?.cli }),
      homedir()
    ),
};

const inFlight = new Map<AgentProviderId, Promise<void>>();

async function readInto(providerId: AgentProviderId, read: () => Promise<UsageWindow[]>) {
  const windows = await read();
  if (windows.length > 0) recordProviderUsage(providerId, { type: 'rate_limit', windows });
}

/**
 * The provider's plan windows, read afresh when its last report is older than
 * the cache window and the provider can be asked directly. Concurrent callers
 * (several composers mounting) share one read.
 */
export async function refreshProviderUsage(
  providerId: AgentProviderId
): Promise<ProviderUsageUpdate | null> {
  const read = USAGE_READERS[providerId];
  const current = getProviderUsage(providerId);
  if (!read || isUsageReportFresh(current?.reportedAt ?? null, Date.now())) return current;
  let pending = inFlight.get(providerId);
  if (!pending) {
    pending = readInto(providerId, read).finally(() => inFlight.delete(providerId));
    inFlight.set(providerId, pending);
  }
  await pending;
  return getProviderUsage(providerId);
}
