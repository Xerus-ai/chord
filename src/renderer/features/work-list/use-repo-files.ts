import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { rpc } from '@renderer/lib/ipc';

/**
 * Git-visible file paths of a work item's repo (tracked + untracked, not
 * ignored) as both the raw ranked-search list and a membership Set for
 * file-reference resolution. Refetches on window focus so new files the
 * agent creates become linkable without a reload.
 */
export function useRepoFiles(workItemId: string | undefined): {
  files: readonly string[];
  fileSet: ReadonlySet<string> | null;
} {
  const { data } = useQuery({
    queryKey: ['workItem', 'repoFiles', workItemId],
    enabled: !!workItemId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const result = await rpc.workItems.listRepoFiles(workItemId as string);
      if (!result.success) throw new Error('Failed to list repo files');
      return result.data.files;
    },
  });

  const fileSet = useMemo(() => (data ? new Set(data) : null), [data]);
  return { files: data ?? [], fileSet };
}
