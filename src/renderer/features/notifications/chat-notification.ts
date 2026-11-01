import type { CloudChatMessage, NotificationView } from '@chord/protocol';
import type { AvatarStackMember } from '@renderer/lib/components/chrome/avatar-stack';

/** The server stores the same length (EXCERPT_LENGTH, server/src/notifications). */
const EXCERPT_LENGTH = 200;

/**
 * The notification an owner gets for a teammate's message in an item they
 * own (use-notifications.ts decides when). The actor comes from the item's
 * roster, never from `sender_name`, which is the sender's email. A message
 * from anyone who is not a person on the roster is not a teammate's message,
 * so it makes none.
 */
export function notificationFromChatMessage(
  message: CloudChatMessage,
  context: { workItemName: string; roster: AvatarStackMember[] }
): NotificationView | null {
  if (message.sender_type !== 'human' || message.sender_id === null) return null;
  const sender = context.roster.find((member) => member.user_id === message.sender_id);
  if (!sender) return null;

  return {
    id: message.id,
    type: 'new_message',
    actor_user_id: sender.user_id,
    actor_name: sender.name,
    actor_email: sender.email,
    actor_avatar_url: null,
    org_id: null,
    org_name: null,
    work_item_id: message.work_item_id,
    work_item_name: context.workItemName,
    work_item_repo_name: null,
    artifact_id: null,
    artifact_name: null,
    comment_id: null,
    message_id: message.id,
    excerpt: message.content.slice(0, EXCERPT_LENGTH),
    read: false,
    created_at: message.created_at,
  };
}
