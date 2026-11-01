import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { REPOS_QUERY_KEY } from '@renderer/lib/hooks/use-repos';
import { rpc } from '@renderer/lib/ipc';
import { buildLocalRepoByRemote, type LocalRepoByRemote } from './shared-sidebar-items';

const NO_REMOTES: LocalRepoByRemote = new Map();

/**
 * This machine's repos by normalized origin, where a teammate's shared item
 * joins the user's own group (shared-items step 3, decision 5). Under the
 * repos key, so adding or archiving a repo reads them again. Until they are
 * read, shared items sit in groups named after the owner's repo.
 */
export function useLocalRepoByRemote(): {
  localRepoByRemote: LocalRepoByRemote;
  error: Error | null;
} {
  const { data, error } = useQuery({
    queryKey: [...REPOS_QUERY_KEY, 'remotes'],
    queryFn: async () => {
      const result = await rpc.repos.listRemotes();
      if (!result.success) throw new Error('repos.listRemotes failed');
      return buildLocalRepoByRemote(result.data.remotes);
    },
    staleTime: 5 * 60_000,
  });
  return useMemo(() => ({ localRepoByRemote: data ?? NO_REMOTES, error }), [data, error]);
}
