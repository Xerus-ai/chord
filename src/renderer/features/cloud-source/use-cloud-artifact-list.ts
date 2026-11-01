import { useQuery } from '@tanstack/react-query';
import { cloudApi } from '@renderer/lib/cloud-api';

export function cloudArtifactListKey(workItemId: string) {
  return ['cloudArtifacts', workItemId] as const;
}

/**
 * A work item's artifacts as the cloud has them (the ones shared with an
 * artifacts-only viewer, for them): one cached list for the teammate's view,
 * its rail and its file bars, refetched by `useCloudArtifactListEvents` when
 * the owner registers (or re-registers, with a new status) or deletes one.
 */
export function useCloudArtifactList(workItemId: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: cloudArtifactListKey(workItemId),
    queryFn: () => cloudApi.getArtifacts(workItemId),
    staleTime: 15_000,
    enabled,
  });
}
