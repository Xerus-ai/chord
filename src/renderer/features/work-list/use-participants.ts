import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { sharingApi, type Participant } from '@renderer/features/sharing/sharing-api';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';

const NO_PARTICIPANTS: Participant[] = [];

export function participantsQueryKey(workItemId: string) {
  return ['participants', workItemId] as const;
}

/**
 * The work item's author and members, one cached roster for every reader
 * (the rail's People, the header, mention menus, the typing line), kept live:
 * an add, a removal or a role change made anywhere (another device, the API,
 * the Share dialog) refetches it, and so does a reconnect or a detected room
 * gap, which may have dropped one of those events. Before this, the rail and
 * the teammate's header read a query nothing invalidated, so a role change
 * made elsewhere stayed stale until the next refetch (devstation-n35).
 */
export function useParticipants(workItemId: string | undefined, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { subscribeEvent } = useSyncSocketContext();
  const active = enabled && workItemId !== undefined;

  const query = useQuery({
    queryKey: participantsQueryKey(workItemId ?? ''),
    queryFn: () => sharingApi.getParticipants(workItemId as string),
    enabled: active,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    if (!workItemId) return;
    // Several readers subscribe at once; one fetch in flight serves them all.
    void queryClient.invalidateQueries(
      { queryKey: participantsQueryKey(workItemId) },
      { cancelRefetch: false }
    );
  }, [queryClient, workItemId]);

  useEffect(() => {
    if (!active || !workItemId) return;
    const offAdded = subscribeEvent('participant_added', refresh, workItemId);
    const offRemoved = subscribeEvent('participant_removed', refresh, workItemId);
    const offRoleChanged = subscribeEvent('participant_role_changed', refresh, workItemId);
    const offConnected = subscribeEvent('$sync/connected', refresh);
    return () => {
      offAdded();
      offRemoved();
      offRoleChanged();
      offConnected();
    };
  }, [active, workItemId, subscribeEvent, refresh]);

  return { participants: query.data ?? NO_PARTICIPANTS, refresh, query };
}
