import { useMemo } from 'react';
import { type AgentProviderDefinition } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import { dependenciesStore } from '@renderer/lib/stores/app-state';
import { useResourceData } from '@renderer/lib/stores/use-resource';

/** Agent CLIs detected on this machine, in registry order. */
export function useInstalledAgents(): AgentProviderDefinition[] {
  const { data: localData } = useResourceData(dependenciesStore.local);
  return useMemo(() => {
    const installedIds = new Set(
      Object.entries(localData ?? {})
        .filter(([, s]) => s.status === 'available' && s.category === 'agent')
        .map(([id]) => id)
    );
    return AGENT_PROVIDERS.filter((p) => installedIds.has(p.id));
  }, [localData]);
}
