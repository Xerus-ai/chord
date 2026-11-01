import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type {
  AgentUpdateCheckResult,
  AgentUpdateError,
  AgentUpdateInfo,
} from '@shared/agent-updates';
import { describeLoadError } from '@renderer/lib/components/load-error-notice';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

export const AGENT_UPDATES_QUERY_KEY = ['dependencies', 'agentUpdates'] as const;

/** Release checks hit npm and OpenAI; a few times a day is enough (devstation-ext). */
const AGENT_UPDATES_STALE_MS = 6 * 60 * 60 * 1000;

/** Agents on this machine compared with their latest releases. */
export function useAgentUpdateCheck() {
  return useQuery<AgentUpdateCheckResult>({
    queryKey: AGENT_UPDATES_QUERY_KEY,
    queryFn: () => rpc.dependencies.checkAgentUpdates(),
    staleTime: AGENT_UPDATES_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export interface AgentUpdateFailure {
  message: string;
  output: string | undefined;
}

export function describeAgentUpdateError(error: AgentUpdateError): AgentUpdateFailure {
  switch (error.type) {
    case 'unknown-agent':
      return { message: `Unknown agent: ${error.id}.`, output: undefined };
    case 'not-installed':
      return { message: 'The agent is no longer installed.', output: undefined };
    case 'no-update-spec':
      return {
        message: 'Chord has no update command for how this agent was installed.',
        output: undefined,
      };
    case 'pty-open-failed':
      return { message: `Could not start the update: ${error.message}`, output: undefined };
    case 'permission-denied':
    case 'command-failed':
      return { message: error.message, output: error.output };
    case 'version-unchanged':
      return {
        message: `The update finished but the agent still reports ${error.version}.`,
        output: error.output,
      };
  }
}

/**
 * Runs agent updates from Settings: tracks which agents are updating and the
 * last failure per agent, toasts a success, and refreshes the update check.
 */
export function useAgentUpdateAction() {
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<ReadonlyMap<string, AgentUpdateFailure>>(new Map());

  const setFailure = useCallback((id: string, failure: AgentUpdateFailure | null) => {
    setFailures((prev) => {
      const next = new Map(prev);
      if (failure) next.set(id, failure);
      else next.delete(id);
      return next;
    });
  }, []);

  const updateAgent = useCallback(
    async (update: AgentUpdateInfo, agentName: string) => {
      setUpdating((prev) => new Set(prev).add(update.id));
      setFailure(update.id, null);
      try {
        const result = await rpc.dependencies.updateAgent(update.id);
        if (result.success) {
          toast({ title: `${agentName} updated to ${result.data.version}` });
        } else {
          setFailure(update.id, describeAgentUpdateError(result.error));
        }
      } catch (error) {
        // The call itself failed (IPC, or the main process threw).
        setFailure(update.id, { message: describeLoadError(error), output: undefined });
      } finally {
        setUpdating((prev) => {
          const next = new Set(prev);
          next.delete(update.id);
          return next;
        });
        await queryClient.invalidateQueries({ queryKey: AGENT_UPDATES_QUERY_KEY });
      }
    },
    [queryClient, setFailure]
  );

  return { updating, failures, updateAgent };
}
