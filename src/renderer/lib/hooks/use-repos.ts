import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { repoIconDetectedChannel } from '@shared/events/repoEvents';
import type { RepoIcon } from '@shared/repo-icons';
import { events, rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';

/**
 * The machine's attached repositories, as a single shared cache entry.
 *
 * Every surface that needs a repo RECORD — its alias, its icon, whether it is
 * archived — reads through this hook. Per-component `repos.getAll()` copies are
 * what let the sidebar and the settings card disagree about a repo: the sidebar
 * derived its repo groups from work item rows alone, so a repo whose icon had
 * just changed kept the old glyph until the window reloaded.
 */
export const REPOS_QUERY_KEY = ['repos'] as const;

/**
 * Shows an auto-detected icon the moment main finishes probing for it, rather
 * than on the next window reload. Adding a repo does not wait on detection, and
 * the startup backfill settles older repos minutes after boot — both land here.
 */
export function wireRepoIconInvalidation(): void {
  events.on(repoIconDetectedChannel, () => {
    void queryClient.invalidateQueries({ queryKey: REPOS_QUERY_KEY });
  });
}

export interface RepoRecord {
  id: string;
  path: string;
  alias: string;
  addedAt: number;
  archivedAt: number | null;
  /**
   * The icon to draw, already parsed by the repos controller. `null` means the
   * repo has never been probed — detection is still owed — and is drawn the
   * same way `{ type: 'letter' }` is, so the difference only matters to main.
   */
  icon: RepoIcon | null;
  workItemCount: number;
}

const NO_REPOS: RepoRecord[] = [];

export function useRepos(options?: { includeArchived?: boolean }): {
  repos: RepoRecord[];
  isLoading: boolean;
  error: Error | null;
  refetchRepos: () => Promise<unknown>;
} {
  const includeArchived = options?.includeArchived ?? false;

  const query = useQuery({
    queryKey: [...REPOS_QUERY_KEY, { includeArchived }],
    queryFn: async () => {
      const result = await rpc.repos.getAll({ includeArchived });
      if (!result.success) throw new Error('repos.getAll failed');
      return result.data.repos as RepoRecord[];
    },
  });

  return {
    // A stable empty array: this feeds memo deps in every consumer.
    repos: query.data ?? NO_REPOS,
    isLoading: query.isLoading,
    error: query.error,
    refetchRepos: query.refetch,
  };
}

/** Re-read every repo list now — both the archived-inclusive entry and the
 *  picker's. Call after any add, archive, icon change, or removal. */
export function useInvalidateRepos(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: REPOS_QUERY_KEY });
  }, [queryClient]);
}
