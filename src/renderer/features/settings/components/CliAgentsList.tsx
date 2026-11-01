import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import { isValidProviderId, resolveInstallCommand } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import type { DependencyState } from '@shared/dependencies';
import type { DetectedAgent } from '@shared/skills/types';
import { type CliAgentStatus } from '@renderer/features/settings/components/connections';
import { getAgentInstallErrorMessage } from '@renderer/lib/components/agent-selector/agent-install';
import { describeLoadError, LoadErrorNotice } from '@renderer/lib/components/load-error-notice';
import { useAppPlatform } from '@renderer/lib/hooks/use-app-platform';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { dependenciesStore } from '@renderer/lib/stores/app-state';
import { useResourceData } from '@renderer/lib/stores/use-resource';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useAgentUpdateAction, useAgentUpdateCheck } from '../use-agent-updates';
import { AgentRow, type AgentRowActions } from './cli-agent-row';

/**
 * Every detectable agent, missing until probed, with the install command for
 * this platform (devstation-fez); none until the platform is known.
 */
function listBaseCliAgents(platform: NodeJS.Platform | undefined): CliAgentStatus[] {
  return AGENT_PROVIDERS.filter((provider) => provider.detectable !== false).map((provider) => ({
    id: provider.id,
    name: provider.name,
    status: 'missing' as const,
    docUrl: provider.docUrl ?? null,
    installCommand: platform ? resolveInstallCommand(provider, platform) : null,
  }));
}

function mapDependencyStatesToCli(
  agentStatuses: Record<string, DependencyState>,
  platform: NodeJS.Platform | undefined
): CliAgentStatus[] {
  const mergedMap = new Map<string, CliAgentStatus>();
  listBaseCliAgents(platform).forEach((agent) => {
    mergedMap.set(agent.id, { ...agent });
  });
  Object.entries(agentStatuses).forEach(([agentId, state]) => {
    const base = mergedMap.get(agentId);
    mergedMap.set(agentId, {
      ...(base ?? { id: agentId, name: agentId, docUrl: null, installCommand: null }),
      id: agentId,
      name: base?.name ?? agentId,
      status: state.status === 'available' ? 'connected' : state.status,
      version: state.version ?? null,
      command: state.path ?? null,
    });
  });
  return Array.from(mergedMap.values());
}

export const CliAgentsList: React.FC = () => {
  const showCustomCommandModal = useShowModal('customCommandModal');
  const { toast } = useToast();
  const platform = useAppPlatform();
  const { data: localData } = useResourceData(dependenciesStore.local);
  const allStatuses = localData ?? {};
  const agentStatuses = Object.fromEntries(
    Object.entries(allStatuses).filter(([, s]) => s.category === 'agent')
  );

  const {
    data: harnessAgents = [],
    error: harnessError,
    refetch: reloadHarness,
  } = useQuery<DetectedAgent[]>({
    queryKey: ['skills', 'detectedAgents'],
    queryFn: async () => {
      const result = await rpc.skills.getDetectedAgents();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to detect installed agent harnesses');
    },
  });

  const harnessMap = useMemo(() => new Map(harnessAgents.map((a) => [a.id, a])), [harnessAgents]);

  const sortedAgents = useMemo(() => {
    return mapDependencyStatesToCli(agentStatuses, platform).sort((a, b) => {
      const aDetected = a.status === 'connected' || (harnessMap.get(a.id)?.installed ?? false);
      const bDetected = b.status === 'connected' || (harnessMap.get(b.id)?.installed ?? false);
      if (aDetected && !bDetected) return -1;
      if (bDetected && !aDetected) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agentStatuses, harnessMap, platform]);

  const handleInstall = useCallback(
    async (agent: CliAgentStatus) => {
      if (!isValidProviderId(agent.id) || dependenciesStore.isInstalling(agent.id)) {
        return;
      }

      const result = await dependenciesStore.install(agent.id);

      if (result.success) {
        toast({
          title: 'Agent installed',
          description: `${agent.name} is ready.`,
        });
        return;
      }

      toast({
        title: 'Install failed',
        description: getAgentInstallErrorMessage(result.error),
        variant: 'destructive',
      });
    },
    [toast]
  );

  const updateCheck = useAgentUpdateCheck();
  const { updating, failures, updateAgent } = useAgentUpdateAction();
  const updatesById = useMemo(
    () => new Map((updateCheck.data?.updates ?? []).map((u) => [u.id as string, u])),
    [updateCheck.data]
  );

  const rowActions = useMemo<AgentRowActions>(
    () => ({
      isInstalling: (id) => dependenciesStore.isInstalling(id),
      onInstallClick: (agent) => {
        void handleInstall(agent);
      },
      onSettingsClick: (providerId) => showCustomCommandModal({ providerId }),
      onUpdateClick: (update, agentName) => {
        void updateAgent(update, agentName);
      },
    }),
    [handleInstall, showCustomCommandModal, updateAgent]
  );

  const checkFailures = updateCheck.data?.failures ?? [];

  return (
    <div className="space-y-3">
      {harnessError && (
        <LoadErrorNotice
          title="Couldn't read installed agent skills and commands"
          message={describeLoadError(harnessError)}
          onRetry={() => void reloadHarness()}
        />
      )}
      {updateCheck.error && (
        <LoadErrorNotice
          title="Couldn't check agents for updates"
          message={describeLoadError(updateCheck.error)}
          onRetry={() => void updateCheck.refetch()}
        />
      )}
      {checkFailures.length > 0 && (
        <LoadErrorNotice
          title="Couldn't check some agents for updates"
          message={checkFailures.map((f) => `${f.id}: ${f.message}`).join('; ')}
        />
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={updateCheck.isFetching}
          onClick={() => void updateCheck.refetch()}
        >
          {updateCheck.isFetching ? (
            <Spinner size="sm" aria-hidden="true" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          {updateCheck.isFetching ? 'Checking for updates…' : 'Check for updates'}
        </Button>
      </div>
      <div className="space-y-2">
        {sortedAgents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            actions={rowActions}
            harness={harnessMap.get(agent.id)}
            update={{
              info: updatesById.get(agent.id),
              isUpdating: updating.has(agent.id),
              failure: failures.get(agent.id),
            }}
          />
        ))}
      </div>
    </div>
  );
};
