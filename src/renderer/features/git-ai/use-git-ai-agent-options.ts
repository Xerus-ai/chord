import { useQueries } from '@tanstack/react-query';
import { getAgentDisplayName } from '@shared/agent-display-name';
import { GIT_AI_AGENTS, gitAiTransport, type GitAiAgent } from '@shared/git-ai';
import { useInstalledAgents } from '@renderer/features/composer-controls/use-installed-agents';
import { rpc } from '@renderer/lib/ipc';

export interface GitAiAgentOption {
  value: GitAiAgent;
  label: string;
  /** Set when the agent can't be picked: an ACP agent that could not start a session. */
  disabledReason?: string;
}

/**
 * The agents Settings › Git › AI offers: those installed here that can run a
 * one-shot prompt — Claude (bundled with Chord), Codex and installed ACP
 * agents — plus `current`, so a saved pick stays visible. An ACP agent is
 * checked by opening a session; one that can't is offered disabled, with why.
 */
export function useGitAiAgentOptions(current: GitAiAgent | undefined): GitAiAgentOption[] {
  const installed = new Set(useInstalledAgents().map((provider) => provider.id));
  const agents = GIT_AI_AGENTS.filter(
    (agent) => agent === 'claude' || agent === current || installed.has(agent)
  );
  const acpAgents = agents.filter((agent) => gitAiTransport(agent) === 'acp');
  const statuses = useQueries({
    queries: acpAgents.map((agent) => ({
      queryKey: ['gitAi', 'agentStatus', agent],
      queryFn: async () => {
        const result = await rpc.gitAi.getAgentStatus({ agent });
        if (!result.success) throw new Error(result.error.message);
        return result.data;
      },
      staleTime: 60_000,
      retry: false,
    })),
  });
  return agents.map((agent) => {
    const index = acpAgents.indexOf(agent);
    const status = index === -1 ? undefined : statuses[index]?.data;
    return {
      value: agent,
      label: getAgentDisplayName(agent),
      ...(status?.state === 'unavailable' && agent !== current
        ? { disabledReason: status.message }
        : {}),
    };
  });
}
