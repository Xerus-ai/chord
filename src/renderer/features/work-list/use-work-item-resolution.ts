import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { cloudApi, type CloudWorkItem } from '@renderer/lib/cloud-api';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import {
  applyWorkItemUpdate,
  commitIfNewer,
  forgetWorkItemVersion,
} from '@renderer/lib/sync/work-item-version-guard';
import {
  decideWorkItemResolution,
  type CloudFetchState,
  type WorkItemResolution,
} from './work-item-resolution-state';

/**
 * Resolves a work item id local-first, then against the cloud. A local hit is
 * derived synchronously during render (the owner path never waits on or fires
 * a cloud fetch); only the cloud fallback is async state. Resolution never
 * depends on the shared-with-me cache — deep links, org/public items, and the
 * sidebar's 30s discovery gap all resolve through `GET /work-items/:id`
 * directly. There is deliberately NO CloudWorkItem → WorkItemRow mapping:
 * `WorkItemRow.repoPath` is local-only NOT NULL and any mapped value would be
 * fabricated. The two shapes stay separate all the way into the view layer.
 *
 * `localListSettled` is the caller's promise that the local list has been read
 * *for this id* — not merely that some earlier read finished. The cloud
 * fallback is only correct once a local miss is a real miss; a stale list would
 * otherwise send a just-created local item to `GET /work-items/:id`.
 */
export function useWorkItemResolution(
  workItemId: string | null,
  localItem: WorkItemRow | undefined,
  localListSettled: boolean
): WorkItemResolution {
  const queryClient = useQueryClient();
  const { subscribeEvent } = useSyncSocketContext();
  const sessionQuery = useAccountSession();

  const isLocalHit = localItem !== undefined;
  const isSignedIn = sessionQuery.data?.isSignedIn === true;

  // Terminal: a live work_item_deleted broadcast for the resolved id. Keyed
  // by id so navigating to another item resets it; REST 404s converge on
  // 'not_found' instead (Edge-Case: no notification path for out-of-room
  // clients, by design).
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const isDeleted = workItemId !== null && deletedId === workItemId;

  const cloudEnabled =
    workItemId !== null && localListSettled && !isLocalHit && isSignedIn && !isDeleted;

  const query = useQuery({
    queryKey: ['workItem', workItemId],
    enabled: cloudEnabled,
    // 4xx outcomes are terminal states, not conditions to poll away.
    retry: false,
    staleTime: 15_000,
    queryFn: async () => {
      const item = await cloudApi.getWorkItem(workItemId!);
      // A header (artifacts shared alone) has no room of its own to race.
      if (item.access_scope === 'artifacts') return item;
      if (commitIfNewer(item.id, item.version_number)) return item;
      // A newer broadcast already landed while this fetch was in flight —
      // never let the stale body regress the cache it would replace.
      return queryClient.getQueryData<CloudWorkItem>(['workItem', workItemId]) ?? item;
    },
  });

  // Live updates for cloud-resolved items: room-scoped work_item_updated
  // applied through the singleton guard, plus a reconnect reseed. Deps are
  // primitives only — an items-array dep would resubscribe on every poll.
  useEffect(() => {
    if (workItemId === null || isLocalHit) return;
    const unsubscribeUpdated = subscribeEvent(
      'work_item_updated',
      (payload) => {
        if (!commitIfNewer(payload.work_item_id, payload.version_number)) return;
        queryClient.setQueryData<CloudWorkItem | ArtifactsOnlyWorkItem>(
          ['workItem', payload.work_item_id],
          (prev) => (prev?.access_scope === 'work_item' ? applyWorkItemUpdate(prev, payload) : prev)
        );
      },
      workItemId
    );
    // Orthogonal to the version guard: creator_device_online is computed
    // live socket state (per-id GET only), not a versioned column — apply
    // directly, never gate on version_number.
    const unsubscribeDevicePresence = subscribeEvent(
      'device_presence_changed',
      (payload) => {
        queryClient.setQueryData<CloudWorkItem | ArtifactsOnlyWorkItem>(
          ['workItem', payload.work_item_id],
          (prev) =>
            prev?.access_scope === 'work_item' && prev.creator_id === payload.user_id
              ? { ...prev, creator_device_online: payload.online }
              : prev
        );
      },
      workItemId
    );
    // Also orthogonal to the version guard: the session registry is its own
    // table with its own whole-set push, so it carries no work-item version
    // and a newer registry must never be dropped because the item row has
    // not changed. The payload IS the full set — replace, never merge, or a
    // thread the owner ended would survive as a tab forever.
    const unsubscribeSessions = subscribeEvent(
      'work_item_sessions_updated',
      (payload) => {
        queryClient.setQueryData<CloudWorkItem | ArtifactsOnlyWorkItem>(
          ['workItem', payload.work_item_id],
          (prev) =>
            prev?.access_scope === 'work_item' ? { ...prev, sessions: payload.sessions } : prev
        );
      },
      workItemId
    );
    const unsubscribeDeleted = subscribeEvent(
      'work_item_deleted',
      (payload) => {
        forgetWorkItemVersion(payload.work_item_id);
        queryClient.removeQueries({ queryKey: ['workItem', payload.work_item_id] });
        setDeletedId(payload.work_item_id);
      },
      workItemId
    );
    const unsubscribeConnected = subscribeEvent('$sync/connected', () => {
      void queryClient.invalidateQueries({ queryKey: ['workItem', workItemId] });
    });
    // What the caller reaches can change while the view is open: added as a
    // member after one artifact was shared alone, removed, or an artifact's
    // sharing changed (devstation-236). The body decides the view (scoped or
    // the work item), so it is read again. Not room-scoped: the one being
    // let in is not in the work item's room yet.
    const refetchOnAccessChange = (payload: { work_item_id: string }) => {
      if (payload.work_item_id !== workItemId) return;
      void queryClient.invalidateQueries({ queryKey: ['workItem', workItemId] });
    };
    const unsubscribeAdded = subscribeEvent('participant_added', refetchOnAccessChange);
    const unsubscribeRemoved = subscribeEvent('participant_removed', refetchOnAccessChange);
    const unsubscribeArtifactAccess = subscribeEvent(
      'artifact_access_changed',
      refetchOnAccessChange
    );
    return () => {
      unsubscribeUpdated();
      unsubscribeDevicePresence();
      unsubscribeSessions();
      unsubscribeDeleted();
      unsubscribeConnected();
      unsubscribeAdded();
      unsubscribeRemoved();
      unsubscribeArtifactAccess();
    };
  }, [workItemId, isLocalHit, subscribeEvent, queryClient]);

  const refetch = query.refetch;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  // A non-CloudApiError rejection carries no status: it maps to the generic
  // retryable error, never to a terminal 4xx state.
  const cloud: CloudFetchState = query.isError
    ? { kind: 'failed', status: query.error instanceof CloudApiError ? query.error.status : null }
    : query.data === undefined
      ? { kind: 'pending' }
      : { kind: 'loaded', item: query.data };

  return decideWorkItemResolution({
    workItemId,
    localItem,
    localListSettled,
    isDeleted,
    sessionPending: sessionQuery.isPending,
    isSignedIn,
    cloud,
    retry,
  });
}
