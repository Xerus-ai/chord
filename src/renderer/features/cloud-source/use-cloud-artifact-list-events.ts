import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { cloudArtifactListKey } from './use-cloud-artifact-list';

/**
 * Keeps a teammate's artifact list current while their view of the work item
 * is open: `artifact_registered` (a page the owner just published) and
 * `artifact_deleted`, both broadcast to the work-item room, refetch it. The
 * list is the `cloudArtifacts` query the view and its rail share.
 */
export function useCloudArtifactListEvents(workItemId: string): void {
  const { subscribeEvent } = useSyncSocketContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    const refetch = (payload: { work_item_id: string }) => {
      if (payload.work_item_id !== workItemId) return;
      void queryClient.invalidateQueries({ queryKey: cloudArtifactListKey(workItemId) });
    };
    const offRegistered = subscribeEvent('artifact_registered', refetch);
    const offDeleted = subscribeEvent('artifact_deleted', refetch);
    return () => {
      offRegistered();
      offDeleted();
    };
  }, [workItemId, subscribeEvent, queryClient]);
}
