import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { GitAiAgent, GitAiAgentStatus, GitAiFailure } from '@shared/git-ai';
import type { Result } from '@shared/result';
import { rpc } from '@renderer/lib/ipc';
import { describeGitAiFailure, type GitAiFailureView } from './describe-git-ai-failure';

/** For reads whose only failures are bugs: the error is thrown into the query. */
async function unwrap<T, E>(call: Promise<Result<T, E>>): Promise<T> {
  const result = await call;
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.data;
}

/**
 * Settings › Git › AI as it applies to `repoId`. Read on every mount (no
 * stale time): a Generate opened right after a settings change uses it.
 */
export function useGitAiSettings(repoId: string | null) {
  return useQuery({
    queryKey: ['gitAi', 'settings', repoId],
    queryFn: () => unwrap(rpc.gitAi.getSettings({ repoId })),
  });
}

/** Whether `agent` can answer now; null agent = settings still loading. */
export function useGitAiAgentStatus(agent: GitAiAgent | null) {
  return useQuery({
    queryKey: ['gitAi', 'agentStatus', agent],
    enabled: agent !== null,
    queryFn: async (): Promise<GitAiAgentStatus> => {
      const result = await rpc.gitAi.getAgentStatus({ agent: agent! });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    staleTime: 60_000,
    retry: false,
  });
}

class GitAiRunFailure extends Error {
  constructor(readonly failure: GitAiFailure) {
    super(failure.type);
  }
}

/**
 * One Generate: runs `run` under a fresh request id, hands the result to
 * `onGenerated` (the only place the field is written), and keeps the reason
 * a run failed. Cancel aborts the run in main; the field keeps its value.
 */
export function useGitAiGeneration<T>(
  run: (requestId: string) => Promise<Result<T, GitAiFailure>>,
  onGenerated: (value: T) => void
) {
  const requestId = useRef<string | null>(null);
  const [failure, setFailure] = useState<GitAiFailureView | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const id = crypto.randomUUID();
      requestId.current = id;
      const result = await run(id);
      if (!result.success) throw new GitAiRunFailure(result.error);
      return result.data;
    },
    onMutate: () => setFailure(null),
    onSuccess: (value) => onGenerated(value),
    onError: (error) => {
      setFailure(
        error instanceof GitAiRunFailure
          ? describeGitAiFailure(error.failure)
          : { reason: error.message, output: null }
      );
    },
    onSettled: () => {
      requestId.current = null;
    },
  });
  const cancel = useCallback(() => {
    if (requestId.current) void rpc.gitAi.cancel({ requestId: requestId.current });
  }, []);
  return {
    start: () => mutation.mutate(),
    cancel,
    generating: mutation.isPending,
    failure,
    dismissFailure: () => setFailure(null),
  };
}
