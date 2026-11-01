import type { ActivatedMember } from '../../access/activate-pending-members.js';
import type { MemberRole } from '../../access/resolve-access.js';
import {
  insertNotifications,
  type NotificationFact,
} from '../../notifications/insert-notifications.js';
import { artifactRoomId, workItemRoomId } from '../../ws/authorize.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import type { ResourceRef } from './resource-scope.js';

/**
 * Live side of a member change. Work-item members keep the roster events the
 * client already consumes (participant_added / _role_changed / _removed, to
 * the room and the user); artifact members get artifact_access_changed on the
 * artifact's rooms and to the user. A new active member also gets a
 * "shared with you" notification; a role change or a removal is not notified
 * (shared-items design §4).
 */

export interface MemberChange {
  ref: ResourceRef;
  userId: string;
  email: string;
  role: MemberRole | null;
  previousRole: MemberRole | null;
  sharerId: string;
}

export async function announceMemberChange(
  connectionManager: ConnectionManager,
  change: MemberChange
): Promise<void> {
  broadcastMemberChange(connectionManager, change);
  if (change.role !== null && change.previousRole === null) {
    await insertNotifications(connectionManager, [sharedWithYouFact(change, change.role)]);
  }
}

/**
 * Shares made to someone outside the team reach them when they join it
 * (activatePendingMembers): announced like a share made then, with one
 * notification per share, all written at once.
 */
export async function announceActivatedMembers(
  connectionManager: ConnectionManager,
  userId: string,
  email: string,
  activated: ActivatedMember[]
): Promise<void> {
  const facts = activated.map((member) => {
    const change: MemberChange = {
      ref: { workItemId: member.work_item_id, artifactId: member.artifact_id },
      userId,
      email,
      role: member.role,
      previousRole: null,
      sharerId: member.granted_by,
    };
    broadcastMemberChange(connectionManager, change);
    return sharedWithYouFact(change, member.role);
  });
  await insertNotifications(connectionManager, facts);
}

function broadcastMemberChange(connectionManager: ConnectionManager, change: MemberChange): void {
  const { ref, userId, email, role, previousRole } = change;

  if (ref.artifactId) {
    const event = {
      type: 'artifact_access_changed' as const,
      payload: { work_item_id: ref.workItemId, artifact_id: ref.artifactId, user_id: userId },
    };
    connectionManager.broadcastToRoom(artifactRoomId(ref.artifactId), event);
    connectionManager.broadcastToRoom(workItemRoomId(ref.workItemId), event);
    connectionManager.broadcastToUser(userId, event);
  } else {
    const roomId = workItemRoomId(ref.workItemId);
    const events = [];
    if (role === null) {
      events.push({
        type: 'participant_removed' as const,
        payload: { work_item_id: ref.workItemId, user_id: userId },
      });
    } else {
      events.push({
        type: 'participant_added' as const,
        payload: { work_item_id: ref.workItemId, user_id: userId, email, role },
      });
      if (previousRole) {
        events.push({
          type: 'participant_role_changed' as const,
          payload: {
            work_item_id: ref.workItemId,
            user_id: userId,
            email,
            role,
            previous_role: previousRole,
          },
        });
      }
    }
    for (const event of events) {
      connectionManager.broadcastToRoom(roomId, event);
      connectionManager.broadcastToUser(userId, event);
    }
  }
}

function sharedWithYouFact(change: MemberChange, role: MemberRole): NotificationFact {
  // The work item is stored even for an artifact shared alone: the sentence
  // names it ("from {work item}"), while the click opens the artifact, which
  // an artifact-only member can reach (notification-navigation.ts).
  return {
    user_id: change.userId,
    type: 'shared_with_you',
    actor_user_id: change.sharerId,
    work_item_id: change.ref.workItemId,
    artifact_id: change.ref.artifactId ?? undefined,
    excerpt: role,
  };
}
