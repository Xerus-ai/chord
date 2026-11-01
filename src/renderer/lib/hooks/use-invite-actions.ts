import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { rpc } from '@renderer/lib/ipc';
import { ACCOUNT_SESSION_KEY } from './useAccount';

/** Pending invites addressed to the current user (the "Invitations to you" card). */
export const MY_INVITES_KEY = ['organizations', 'invites', 'mine'] as const;

// Every invite mutation can change the caller's org set and active workspace,
// so all of these surfaces refetch: the session (active orgId), the org
// membership list, and the user's own pending invites.
function invalidateOrgSurfaces(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
  void queryClient.invalidateQueries({ queryKey: ['organizations', 'memberships'] });
  void queryClient.invalidateQueries({ queryKey: [...MY_INVITES_KEY] });
}

/**
 * Accept/decline actions for invites addressed to the current user, shared by
 * the notification dropdown and the Team settings "Invitations to you" card so
 * both stay in lockstep. Accepting switches the active workspace into the
 * accepted org via the main-process account service.
 */
export function useInviteActions() {
  const queryClient = useQueryClient();

  const accept = useMutation({
    mutationFn: async (inviteId: string) => {
      const result = await cloudTeamApi.acceptInvite(inviteId);
      // Persist + re-sync the active org in the main process; the server
      // resolves the caller into it because a membership row now exists.
      const switched = await rpc.account.setActiveOrg(result.org_id);
      if (!switched.success) {
        throw new Error(switched.error ?? 'Failed to switch workspace');
      }
      return result;
    },
    onSuccess: () => invalidateOrgSurfaces(queryClient),
  });

  const decline = useMutation({
    mutationFn: (inviteId: string) => cloudTeamApi.declineInvite(inviteId),
    onSuccess: () => invalidateOrgSurfaces(queryClient),
  });

  return { accept, decline };
}
