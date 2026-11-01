import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import {
  providerUsageChannel,
  sessionTelemetryChannel,
  type ProviderUsageUpdate,
  type SessionTelemetryUpdate,
} from '@shared/events/sessionTelemetryEvents';
import { events, rpc } from '@renderer/lib/ipc';

/**
 * A live session's context fill and cost: seeded from main's snapshot (the
 * session may have reported before this composer mounted), then kept current
 * by the push channel.
 */
export function useSessionTelemetry(sessionId: string): SessionTelemetryUpdate | undefined {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['sessionTelemetry', sessionId],
    queryFn: async () => {
      const result = await rpc.agentSessions.getTelemetry({ sessionId });
      if (!result.success) throw new Error('Could not read session telemetry');
      return result.data;
    },
    staleTime: Infinity,
  });
  useEffect(
    () =>
      events.on(
        sessionTelemetryChannel,
        (update) => queryClient.setQueryData(['sessionTelemetry', sessionId], update),
        sessionId
      ),
    [sessionId, queryClient]
  );
  return data;
}

/**
 * The provider's plan usage windows. Main reads them afresh when its last
 * report is stale and the provider can be asked outside a session (Codex);
 * otherwise they are null until one of its sessions reports them (Claude).
 * `refresh` asks again — main's cache keeps that cheap.
 */
export function useProviderUsage(providerId: AgentProviderId): {
  usage: ProviderUsageUpdate | null;
  refresh: () => void;
} {
  const queryClient = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ['providerUsage', providerId],
    queryFn: async () => {
      const result = await rpc.providerUsage.refresh({ providerId });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    staleTime: Infinity,
    retry: false,
  });
  useEffect(
    () =>
      events.on(
        providerUsageChannel,
        (update) => queryClient.setQueryData(['providerUsage', providerId], update),
        providerId
      ),
    [providerId, queryClient]
  );
  return { usage: data ?? null, refresh: () => void refetch() };
}
