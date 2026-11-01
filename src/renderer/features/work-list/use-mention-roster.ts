import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Participant } from '@renderer/features/sharing/sharing-api';
import { useSharing } from '@renderer/features/sharing/use-sharing';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { memberMentionRoster, mentionRoster, type MentionPerson } from './mention-access';

/**
 * Who a viewer can @mention (step 4, decision 8). The owner: the whole team,
 * marked by access, so a mention can share. A teammate: the people who can
 * see the item, and the team when it has team access and they are in it
 * (reading the team's members takes membership). Null until the sharing state
 * is read, or while `enabled` is false; the mention menu then reads the
 * people with access itself.
 */
export function useMentionRoster({
  workItemId,
  viewer,
  participants,
  enabled,
}: {
  workItemId: string;
  viewer: 'owner' | 'member';
  participants: Participant[];
  enabled: boolean;
}): MentionPerson[] | null {
  // Through useSharing, which the server's doorbells keep current: the owner
  // opening the item to the team must reach a teammate's menu without a
  // reload (devstation-bf9; a bare query on the same key went stale).
  const sharing = useSharing({ workItemId }, { enabled });
  const teamId = sharing.state?.team.id;
  const generalAccess = sharing.state?.general_access;
  const teamCanOpen = generalAccess === 'team';

  const memberships = useQuery({
    queryKey: ['organizations', 'memberships'],
    queryFn: () => cloudTeamApi.getOrgs(),
    enabled: enabled && viewer === 'member' && teamCanOpen,
  });
  const inTeam =
    viewer === 'owner' ||
    (teamId !== undefined && (memberships.data ?? []).some((m) => m.org_id === teamId));
  const readsTeam =
    enabled && teamId !== undefined && (viewer === 'owner' || (teamCanOpen && inTeam));
  const team = useQuery({
    queryKey: ['orgMembers', teamId],
    queryFn: () => cloudTeamApi.getOrgMembers(teamId!),
    enabled: readsTeam,
    staleTime: 60_000,
  });

  return useMemo(() => {
    if (generalAccess === undefined) return null;
    if (viewer === 'owner') {
      return team.data ? mentionRoster({ participants, team: team.data, generalAccess }) : null;
    }
    if (!teamCanOpen) return memberMentionRoster({ participants, team: null, generalAccess });
    if (!memberships.data) return null;
    if (!inTeam) return memberMentionRoster({ participants, team: null, generalAccess });
    return team.data ? memberMentionRoster({ participants, team: team.data, generalAccess }) : null;
  }, [viewer, participants, generalAccess, teamCanOpen, memberships.data, inTeam, team.data]);
}
