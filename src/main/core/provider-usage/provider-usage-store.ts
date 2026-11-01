import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import {
  providerUsageChannel,
  type ProviderUsageUpdate,
} from '@shared/events/sessionTelemetryEvents';
import { EMPTY_SESSION_TELEMETRY, reduceSessionTelemetry } from '@shared/session-telemetry';
import { events } from '@main/lib/events';

/**
 * Each provider's latest plan usage windows. Windows are an account fact, not
 * a session one — a limit reported by one Claude session is the limit every
 * Claude tab is under — so they are keyed by provider.
 */
const byProvider = new Map<AgentProviderId, ProviderUsageUpdate>();

export function recordProviderUsage(providerId: AgentProviderId, event: AgentOutputEvent): void {
  if (event.type !== 'rate_limit') return;
  const prevWindows = byProvider.get(providerId)?.windows ?? [];
  const { windows } = reduceSessionTelemetry(
    { ...EMPTY_SESSION_TELEMETRY, windows: prevWindows },
    event
  );
  const update: ProviderUsageUpdate = { providerId, windows, reportedAt: Date.now() };
  byProvider.set(providerId, update);
  events.emit(providerUsageChannel, update, providerId);
}

/** Null until a session of this provider has reported its windows. */
export function getProviderUsage(providerId: AgentProviderId): ProviderUsageUpdate | null {
  return byProvider.get(providerId) ?? null;
}
