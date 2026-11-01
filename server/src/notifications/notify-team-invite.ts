import type { ConnectionManager } from '../ws/connection-manager.js';
import { insertNotifications } from './insert-notifications.js';

export interface TeamInviteMade {
  inviteId: string;
  orgId: string;
  inviterId: string;
  inviteeId: string;
}

/**
 * "{inviter} invited you to join {team}", for an invitee who already has an
 * account. The live frame carries the invite id so the bell's inline
 * Accept/Decline can act on it; the stored row does not.
 */
export async function notifyTeamInvite(
  manager: ConnectionManager,
  made: TeamInviteMade
): Promise<void> {
  await insertNotifications(manager, [
    {
      user_id: made.inviteeId,
      type: 'team_invite',
      actor_user_id: made.inviterId,
      org_id: made.orgId,
      invite_id: made.inviteId,
    },
  ]);
}
