import { useMemo } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { dependenciesStore } from '@renderer/lib/stores/app-state';
import { useResourceData } from '@renderer/lib/stores/use-resource';
import { agentConfig } from '@renderer/utils/agentConfig';
import { getAgentInstallErrorMessage } from './agent-install';
import { buildAgentGroups, getAssumedInstalledAgents } from './agent-selector-options';

export function useAgentAvailability({
  connectionId,
  value,
}: {
  connectionId?: string;
  value: AgentProviderId | null;
}) {
  const dependencyResource = connectionId
    ? dependenciesStore.getRemote(connectionId)
    : dependenciesStore.local;
  const { data: dependencyData } = useResourceData(dependencyResource);
  const { toast } = useToast();

  const installedAgents = useMemo(
    () =>
      dependencyData
        ? Object.entries(dependencyData)
            .filter(([, state]) => state.category === 'agent' && state.status === 'available')
            .map(([id]) => id)
        : [],
    [dependencyData]
  );

  const assumedInstalledAgents = useMemo(
    () => getAssumedInstalledAgents(value, dependencyData),
    [value, dependencyData]
  );

  const groups = useMemo(
    () => buildAgentGroups(installedAgents, assumedInstalledAgents),
    [installedAgents, assumedInstalledAgents]
  );
  const installingAgents = new Set<AgentProviderId>();
  for (const group of groups) {
    for (const item of group.items) {
      if (dependenciesStore.isInstalling(item.agentId, connectionId)) {
        installingAgents.add(item.agentId);
      }
    }
  }

  async function installAgent(agentId: AgentProviderId): Promise<void> {
    if (dependenciesStore.isInstalling(agentId, connectionId)) return;
    const result = await dependenciesStore.install(agentId, connectionId);
    if (!result.success) {
      toast({
        title: 'Install failed',
        description: getAgentInstallErrorMessage(result.error),
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'Agent installed', description: `${agentConfig[agentId].name} is ready.` });
  }

  return {
    groups,
    dependencyData,
    installingAgents,
    installAgent,
  };
}
