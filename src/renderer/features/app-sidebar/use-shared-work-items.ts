import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { cloudApi, type SharedWithMeRow } from '@renderer/lib/cloud-api';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import {
  applyWorkItemUpdate,
  commitIfNewer,
  forgetWorkItemVersion,
} from '@renderer/lib/sync/work-item-version-guard';
import { splitSharedRows } from './shared-rows';

const SHARED_WITH_ME_KEY = ['sidebar', 'sharedWithMe'] as const;

const noopRoomStatus = () => {};

export function useSharedWorkItems() {
  const queryClient = useQueryClient();
  const { subscribeEvent, acquireWorkItemRoom, acquireArtifactRoom } = useSyncSocketContext();

  const { data, isPending, error } = useQuery({
    queryKey: SHARED_WITH_ME_KEY,
    queryFn: async () => {
      const fetched = await cloudApi.getSharedWithMe();
      const prev = queryClient.getQueryData<SharedWithMeRow[]>(SHARED_WITH_ME_KEY);
      // Reconcile every fetched row against the singleton version guard. A
      // 30s poll can resolve with a version OLDER than one a live
      // work_item_updated broadcast already applied to the cache; when the
      // fetch is not newer, keep the cached row so the poll can't visibly
      // regress name/status/pr fields. commitIfNewer also seeds the guard on
      // the winning (newer) rows — the same seeding the socket path relies on.
      return fetched.map((item) => {
        // An item reached only through its artifacts has no room to race.
        if (item.access_scope === 'artifacts') return item;
        if (commitIfNewer(item.id, item.version_number)) return item;
        return prev?.find((p) => p.id === item.id) ?? item;
      });
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const split = useMemo(() => splitSharedRows(data ?? []), [data]);

  // Hold room membership for every shared item: work_item_updated only
  // broadcasts to room members, and joining is the access-checked channel.
  // An item reached only through its artifacts holds their rooms instead:
  // its work item's room would refuse it (shared-rows.ts).
  const roomIdsKey = [...split.workItemRoomIds].sort().join(',');
  useEffect(() => {
    if (!roomIdsKey) return;
    const releases = roomIdsKey.split(',').map((id) => acquireWorkItemRoom(id, noopRoomStatus));
    return () => {
      for (const release of releases) release();
    };
  }, [roomIdsKey, acquireWorkItemRoom]);
  const artifactRoomIdsKey = [...split.artifactRoomIds].sort().join(',');
  useEffect(() => {
    if (!artifactRoomIdsKey) return;
    const releases = artifactRoomIdsKey
      .split(',')
      .map((id) => acquireArtifactRoom(id, noopRoomStatus));
    return () => {
      for (const release of releases) release();
    };
  }, [artifactRoomIdsKey, acquireArtifactRoom]);

  useEffect(() => {
    const unsubscribeUpdated = subscribeEvent('work_item_updated', (payload) => {
      if (!commitIfNewer(payload.work_item_id, payload.version_number)) return;
      queryClient.setQueryData<SharedWithMeRow[]>(SHARED_WITH_ME_KEY, (prev) => {
        if (!prev) return prev;
        return prev.map((item) =>
          item.id === payload.work_item_id && item.access_scope === 'work_item'
            ? applyWorkItemUpdate(item, payload)
            : item
        );
      });
    });
    // The sidebar holds every shared item's room, so a deleted item's
    // post-delete broadcast reaches here; drop the row and forget its guard
    // entry (a recreated id must not inherit the dead item's version).
    const unsubscribeDeleted = subscribeEvent('work_item_deleted', (payload) => {
      forgetWorkItemVersion(payload.work_item_id);
      queryClient.setQueryData<SharedWithMeRow[]>(SHARED_WITH_ME_KEY, (prev) =>
        prev ? prev.filter((item) => item.id !== payload.work_item_id) : prev
      );
    });
    // T0.8: thin snapshot broadcast on every accepted worktree metadata push
    // — replace the item's worktrees in place, same shape as the REST fetch
    // returns them, no separate cache entry to reconcile.
    const unsubscribeWorktreesUpdated = subscribeEvent('work_item_worktrees_updated', (payload) => {
      queryClient.setQueryData<SharedWithMeRow[]>(SHARED_WITH_ME_KEY, (prev) => {
        if (!prev) return prev;
        return prev.map((item) =>
          item.id === payload.work_item_id && item.access_scope === 'work_item'
            ? { ...item, worktrees: payload.worktrees }
            : item
        );
      });
    });
    const unsubscribeAdded = subscribeEvent('participant_added', () => {
      void queryClient.invalidateQueries({ queryKey: SHARED_WITH_ME_KEY });
    });
    // A removal reads the list again rather than dropping the row: the item
    // may still be reached through an artifact shared alone.
    const unsubscribeRemoved = subscribeEvent('participant_removed', () => {
      void queryClient.invalidateQueries({ queryKey: SHARED_WITH_ME_KEY });
    });
    const unsubscribeArtifactAccess = subscribeEvent('artifact_access_changed', () => {
      void queryClient.invalidateQueries({ queryKey: SHARED_WITH_ME_KEY });
    });
    const unsubscribeConnected = subscribeEvent('$sync/connected', () => {
      void queryClient.invalidateQueries({ queryKey: SHARED_WITH_ME_KEY });
    });
    return () => {
      unsubscribeUpdated();
      unsubscribeDeleted();
      unsubscribeWorktreesUpdated();
      unsubscribeAdded();
      unsubscribeRemoved();
      unsubscribeArtifactAccess();
      unsubscribeConnected();
    };
  }, [subscribeEvent, queryClient]);

  return {
    sharedItems: split.workItems,
    artifactsOnlyItems: split.artifactsOnly,
    isPending,
    hasError: !!error,
  };
}
