import type { CloudGitStateMeta } from '@chord/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';

const cloudGitStateKey = (workItemId: string) => ['cloudGitState', workItemId] as const;

/**
 * Latest owner-pushed git snapshot metadata for one work item. Seeded from
 * the REST GET; the git_state_updated thin ping and every socket (re)connect
 * invalidate the query — react-query refetches only while a consumer is
 * mounted, which is exactly why the ping carries no snapshot content. A 404
 * resolves to null: the owner has never synced (Edge-Case: also covers
 * items without a repo), which the tab renders as a real state, not an error.
 * `enabled` false reads nothing: an artifacts-only viewer is refused the route.
 */
export function useCloudGitState(workItemId: string, enabled = true) {
  const queryClient = useQueryClient();
  const { subscribeEvent } = useSyncSocketContext();

  useEffect(() => {
    if (!enabled) return;
    const unsubscribePing = subscribeEvent(
      'git_state_updated',
      () => {
        void queryClient.invalidateQueries({ queryKey: cloudGitStateKey(workItemId) });
      },
      workItemId
    );
    const unsubscribeConnected = subscribeEvent('$sync/connected', () => {
      void queryClient.invalidateQueries({ queryKey: cloudGitStateKey(workItemId) });
    });
    return () => {
      unsubscribePing();
      unsubscribeConnected();
    };
  }, [workItemId, enabled, subscribeEvent, queryClient]);

  return useQuery<CloudGitStateMeta | null>({
    queryKey: cloudGitStateKey(workItemId),
    queryFn: async () => {
      try {
        return await cloudApi.getGitState(workItemId);
      } catch (error) {
        if (error instanceof CloudApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled,
  });
}
