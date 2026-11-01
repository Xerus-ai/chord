import type { NotificationView } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import { mergeNotifications } from './notification-history';
import { clickForNotification } from './notification-navigation';

/**
 * The bell shows one list: the persisted history (GET /notifications) merged
 * with the live frames that arrived since, deduped by id, newest first. Both
 * are the same NotificationView, so everything a click needs survives a
 * restart: an artifact share keeps its artifact id, which the click opens.
 */
function view(overrides: Partial<NotificationView>): NotificationView {
  return {
    id: 'n1',
    type: 'shared_with_you',
    actor_user_id: 'u1',
    actor_name: 'Ada',
    actor_email: 'ada@example.com',
    actor_avatar_url: null,
    org_id: null,
    org_name: null,
    work_item_id: 'w1',
    work_item_name: 'Item',
    work_item_repo_name: null,
    artifact_id: 'art1',
    artifact_name: 'Memo',
    comment_id: null,
    message_id: null,
    excerpt: 'view',
    read: false,
    created_at: '2026-09-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeNotifications', () => {
  it('keeps the artifact id of an artifact share from history, so the click can open it', () => {
    const [merged] = mergeNotifications([view({})], []);
    expect(merged?.artifact_id).toBe('art1');
    expect(clickForNotification(merged!)?.target).toEqual({
      view: 'artifact-link',
      params: { artifactId: 'art1' },
    });
  });

  it('dedupes by id, newest first', () => {
    const older = view({ id: 'a', created_at: '2026-09-26T00:00:00.000Z' });
    const newer = view({ id: 'b', created_at: '2026-09-27T00:00:00.000Z' });
    expect(mergeNotifications([older], [newer, older]).map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('keeps a row read once either side has read it', () => {
    expect(mergeNotifications([view({ read: true })], [view({ read: false })])[0]?.read).toBe(true);
    expect(mergeNotifications([view({ read: false })], [view({ read: true })])[0]?.read).toBe(true);
  });

  it("keeps a live frame's invite id over the history row, which never stores one", () => {
    const history = view({ type: 'team_invite' });
    const live = { ...history, invite_id: 'inv1' };
    expect(mergeNotifications([history], [live])[0]?.invite_id).toBe('inv1');
  });
});
