import { useQuery, type QueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

function workItemArtifactsKey(workItemId: string) {
  return ['artifacts', 'list', workItemId] as const;
}

/**
 * A work item's artifacts, each with its repo-relative path when it is a
 * repo file. The one query every view of the list reads (the rail, the
 * band, the tabs, the transcript's chips), so all of them share one cache.
 */
export function useWorkItemArtifacts(workItemId: string) {
  return useQuery({
    queryKey: workItemArtifactsKey(workItemId),
    queryFn: async () => (await rpc.artifacts.listByWorkItem(workItemId)).data.artifacts,
    refetchInterval: 10000,
  });
}

/** Refetches the list after something changed it: a publish, an approval, a new tab. */
export function invalidateWorkItemArtifacts(queryClient: QueryClient, workItemId: string) {
  return queryClient.invalidateQueries({ queryKey: workItemArtifactsKey(workItemId) });
}
