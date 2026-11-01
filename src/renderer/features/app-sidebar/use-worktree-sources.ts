import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { RepoWorktreeSources, RepoWorktreeSourcesFailure } from '@shared/worktree-sources';
import { rpc } from '@renderer/lib/ipc';

export const WORKTREE_SOURCES_QUERY_KEY = ['worktreeSources', 'list'] as const;

/** A checkout made in a terminal shows up within this long, or on focus. */
const WORKTREE_SOURCES_INTERVAL_MS = 30_000;

const NO_SOURCES: RepoWorktreeSources[] = [];

/**
 * Every registered repository's checkouts Chord did not make (plan §Phase 3
 * slice 6). A repository whose worktrees could not be read is in `failures`,
 * named with why.
 *
 * Keyed by the registered repositories, so a repository just added is read at
 * once rather than on the next poll — the adopt e2e waited over a minute for
 * a new repo's Claude Code worktree to appear.
 */
export function useWorktreeSources(repoIds: readonly string[]): {
  sources: RepoWorktreeSources[];
  failures: RepoWorktreeSourcesFailure[];
  error: Error | null;
} {
  const { data, error } = useQuery({
    queryKey: [...WORKTREE_SOURCES_QUERY_KEY, [...repoIds].sort().join(',')],
    queryFn: async () => {
      const result = await rpc.worktreeSources.list();
      if (!result.success) throw new Error('worktreeSources.list failed');
      return result.data;
    },
    refetchInterval: WORKTREE_SOURCES_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
  return {
    sources: data?.repos ?? NO_SOURCES,
    failures: data?.failures ?? [],
    error: error instanceof Error ? error : null,
  };
}

export function useInvalidateWorktreeSources(): () => void {
  const queryClient = useQueryClient();
  return useCallback(
    () => void queryClient.invalidateQueries({ queryKey: WORKTREE_SOURCES_QUERY_KEY }),
    [queryClient]
  );
}
