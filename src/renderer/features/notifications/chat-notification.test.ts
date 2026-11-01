import type { CloudChatMessage } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import { notificationFromChatMessage } from './chat-notification';

/**
 * The owner hears about a teammate's chat message in an item they own while
 * looking elsewhere (use-notifications.ts). The message's sender_name is the
 * sender's email, so the actor comes from the item's roster instead: the same
 * name rule as every other notification.
 */
function message(overrides: Partial<CloudChatMessage> = {}): CloudChatMessage {
  return {
    id: 'm1',
    work_item_id: 'w1',
    session_id: null,
    sender_id: 'u-maya',
    sender_type: 'human',
    sender_name: 'maya@example.com',
    content: 'z'.repeat(230),
    message_type: 'text',
    metadata: {},
    created_at: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

const roster = [
  { user_id: 'u-maya', name: 'Maya', email: 'maya@example.com' },
  { user_id: 'u-kaden', name: null, email: 'kaden@example.com' },
];

describe('notificationFromChatMessage', () => {
  it('is a new_message from the rostered sender, pointing at the message', () => {
    expect(
      notificationFromChatMessage(message(), { workItemName: 'Landing page copy', roster })
    ).toEqual({
      id: 'm1',
      type: 'new_message',
      actor_user_id: 'u-maya',
      actor_name: 'Maya',
      actor_email: 'maya@example.com',
      actor_avatar_url: null,
      org_id: null,
      org_name: null,
      work_item_id: 'w1',
      work_item_name: 'Landing page copy',
      work_item_repo_name: null,
      artifact_id: null,
      artifact_name: null,
      comment_id: null,
      message_id: 'm1',
      excerpt: 'z'.repeat(200),
      read: false,
      created_at: '2026-09-27T10:00:00.000Z',
    });
  });

  it('keeps a rostered account with no name as its email, for the display rule', () => {
    const n = notificationFromChatMessage(message({ sender_id: 'u-kaden' }), {
      workItemName: 'Landing page copy',
      roster,
    });
    expect(n).toMatchObject({ actor_name: null, actor_email: 'kaden@example.com' });
  });

  it('is nothing for a sender who is not on the roster, or not a person', () => {
    const context = { workItemName: 'Landing page copy', roster };
    expect(notificationFromChatMessage(message({ sender_id: 'u-stranger' }), context)).toBeNull();
    expect(
      notificationFromChatMessage(message({ sender_id: null, sender_type: 'agent' }), context)
    ).toBeNull();
  });
});
