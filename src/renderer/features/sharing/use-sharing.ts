import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { sharingApi, type GeneralAccess, type MemberRole, type SharingRef } from './sharing-api';

export function sharingQueryKey(ref: SharingRef) {
  return ['sharing', ref.workItemId, ref.artifactId ?? null] as const;
}

/**
 * The sharing state of one work item or artifact, kept current by the
 * server's doorbells (member and general-access changes), plus the author's
 * actions. After a work-item change the main process re-evaluates git-state
 * capture at once instead of on its next refresh — whether an item is shared
 * decides whether its diffs are published.
 */
export function useSharing(ref: SharingRef, { enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { subscribeEvent } = useSyncSocketContext();
  const queryKey = sharingQueryKey(ref);

  const query = useQuery({ queryKey, queryFn: () => sharingApi.getSharing(ref), enabled });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['sharing', ref.workItemId] });
    await queryClient.invalidateQueries({ queryKey: ['participants', ref.workItemId] });
    if (!ref.artifactId) await rpc.syncQueue.kickGitStateCapture();
  }, [queryClient, ref.workItemId, ref.artifactId]);

  useEffect(() => {
    const refetch = () =>
      void queryClient.invalidateQueries({ queryKey: ['sharing', ref.workItemId] });
    const offs = [
      subscribeEvent('participant_added', refetch, ref.workItemId),
      subscribeEvent('participant_removed', refetch, ref.workItemId),
      subscribeEvent('artifact_access_changed', refetch, ref.workItemId),
      subscribeEvent('work_item_updated', refetch, ref.workItemId),
      subscribeEvent('$sync/connected', refetch),
    ];
    return () => offs.forEach((off) => off());
  }, [subscribeEvent, queryClient, ref.workItemId]);

  return {
    state: query.data ?? null,
    error: query.error,
    isLoading: query.isLoading,
    addMember: async (email: string, role: MemberRole, addToTeam: boolean) => {
      await sharingApi.addMember(ref, email, role, addToTeam);
      await refresh();
    },
    updateMemberRole: async (memberId: string, role: MemberRole) => {
      await sharingApi.updateMemberRole(ref, memberId, role);
      await refresh();
    },
    removeMember: async (memberId: string) => {
      await sharingApi.removeMember(ref, memberId);
      await refresh();
    },
    setGeneralAccess: async (access: GeneralAccess, role: MemberRole) => {
      await sharingApi.setGeneralAccess(ref, access, role);
      await refresh();
    },
    setLinkComments: async (enabled: boolean) => {
      await sharingApi.setLinkComments(ref, enabled);
      await refresh();
    },
  };
}
