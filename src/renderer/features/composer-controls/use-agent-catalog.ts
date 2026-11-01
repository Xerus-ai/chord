import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AgentControlCatalog } from '@shared/agent-control-catalog';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { agentCatalogChannel } from '@shared/events/agentCatalogEvents';
import { events, rpc } from '@renderer/lib/ipc';

const catalogKey = (providerId: AgentProviderId, sessionId: string | undefined) =>
  ['agentCatalog', providerId, sessionId ?? null] as const;

/**
 * What the composer can control for `providerId` in `sessionId`. Main answers
 * from the provider's own source — the Claude CLI probe, the catalog the
 * session's live agent reported, the provider's latest reported one, or its
 * static flag table. A live agent's report changes the answer for that
 * session and for the provider, so every catalog of that provider refetches
 * on it; `refresh` re-asks the provider.
 */
export function useAgentCatalog(providerId: AgentProviderId, sessionId?: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: catalogKey(providerId, sessionId),
    queryFn: async (): Promise<AgentControlCatalog> => {
      const result = await rpc.agentCatalog.get({ providerId, sessionId });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    staleTime: Infinity,
    retry: false,
  });
  useEffect(
    () =>
      events.on(
        agentCatalogChannel,
        () => void queryClient.invalidateQueries({ queryKey: ['agentCatalog', providerId] }),
        providerId
      ),
    [providerId, queryClient]
  );
  const refresh = useMutation({
    mutationFn: async () => {
      const result = await rpc.agentCatalog.refresh({ providerId, sessionId });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (catalog) => queryClient.setQueryData(catalogKey(providerId, sessionId), catalog),
  });
  return {
    catalog: query.data,
    error: query.error ?? refresh.error,
    isLoading: query.isLoading || refresh.isPending,
    refresh: () => refresh.mutate(),
  };
}
