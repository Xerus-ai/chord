import type { NotificationView } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import { describeNotification, notificationPlainText } from './describe-notification';

/**
 * A notification row stores facts; this builds the sentence the bell and the
 * OS notification show (shared-items design §4). Names come from the roster
 * the server joined in, so no row ever shows an email where a name exists.
 */
function view(overrides: Partial<NotificationView>): NotificationView {
  return {
    id: 'n1',
    type: 'shared_with_you',
    actor_user_id: 'u-raghav',
    actor_name: 'Raghav',
    actor_email: 'raghav@example.com',
    actor_avatar_url: 'https://avatars.test/raghav.png',
    org_id: null,
    org_name: null,
    work_item_id: 'w1',
    work_item_name: 'Landing page copy',
    work_item_repo_name: 'marketing-site',
    artifact_id: null,
    artifact_name: null,
    comment_id: null,
    message_id: null,
    excerpt: null,
    read: false,
    created_at: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

const bold = (text: string) => ({ text, bold: true });
const plain = (text: string) => ({ text, bold: false });

describe('describeNotification', () => {
  it('a shared work item: the sharer, the item, its repo and the role', () => {
    expect(describeNotification(view({ excerpt: 'edit' }))).toEqual({
      actor: { name: 'Raghav', avatarUrl: 'https://avatars.test/raghav.png' },
      line1: [bold('Raghav'), plain(' shared '), bold('Landing page copy')],
      line2: 'marketing-site · Can edit',
    });
  });

  it('a shared work item with no repo shows the role alone', () => {
    const d = describeNotification(view({ excerpt: 'view', work_item_repo_name: null }));
    expect(d.line2).toBe('Can view');
  });

  it('one shared artifact: the artifact, and the work item it is from', () => {
    const d = describeNotification(
      view({ excerpt: 'view', artifact_id: 'a1', artifact_name: 'pricing-spec.md' })
    );
    expect(d.line1).toEqual([bold('Raghav'), plain(' shared '), bold('pricing-spec.md')]);
    expect(d.line2).toBe('from Landing page copy · Can view');
  });

  it('a chat mention: the work item, and the message', () => {
    const d = describeNotification(
      view({ type: 'mentioned', message_id: 'm1', excerpt: '@Kaden can you check the CTA?' })
    );
    expect(d.line1).toEqual([
      bold('Raghav'),
      plain(' mentioned you in '),
      bold('Landing page copy'),
    ]);
    expect(d.line2).toBe('“@Kaden can you check the CTA?”');
  });

  it('a comment mention: the artifact the comment is on', () => {
    const d = describeNotification(
      view({
        type: 'mentioned',
        artifact_id: 'a1',
        artifact_name: 'hero.html',
        comment_id: 'c1',
        excerpt: '@Kaden too dark?',
      })
    );
    expect(d.line1).toEqual([
      bold('Raghav'),
      plain(' mentioned you in a comment on '),
      bold('hero.html'),
    ]);
    expect(d.line2).toBe('“@Kaden too dark?”');
  });

  it('a chat message', () => {
    const d = describeNotification(view({ type: 'new_message', message_id: 'm1', excerpt: 'hi' }));
    expect(d.line1).toEqual([
      bold('Raghav'),
      plain(' sent a message in '),
      bold('Landing page copy'),
    ]);
    expect(d.line2).toBe('“hi”');
  });

  it('a comment on your artifact', () => {
    const d = describeNotification(
      view({
        type: 'artifact_comment',
        actor_name: 'Maya',
        artifact_id: 'a1',
        artifact_name: 'hero.html',
        comment_id: 'c1',
        excerpt: 'CTA contrast is too low',
      })
    );
    expect(d.line1).toEqual([bold('Maya'), plain(' commented on '), bold('hero.html')]);
    expect(d.line2).toBe('“CTA contrast is too low”');
  });

  it('a team invite: the inviter and the team', () => {
    const d = describeNotification(
      view({ type: 'team_invite', work_item_id: null, org_id: 'o1', org_name: 'Acme' })
    );
    expect(d.line1).toEqual([bold('Raghav'), plain(' invited you to join '), bold('Acme')]);
    expect(d.line2).toBeNull();
  });

  it('an account with no name shows its email', () => {
    const d = describeNotification(view({ excerpt: 'edit', actor_name: null }));
    expect(d.actor.name).toBe('raghav@example.com');
    expect(d.line1[0]).toEqual(bold('raghav@example.com'));
  });

  it('a deleted account, work item, artifact or team is said so, not left blank', () => {
    expect(
      describeNotification(
        view({
          excerpt: 'edit',
          actor_user_id: null,
          actor_name: null,
          actor_email: null,
          actor_avatar_url: null,
          work_item_id: null,
          work_item_name: null,
        })
      )
    ).toEqual({
      actor: { name: 'A deleted account', avatarUrl: null },
      line1: [bold('A deleted account'), plain(' shared '), plain('a work item that was deleted')],
      line2: 'Can edit',
    });
    expect(describeNotification(view({ type: 'artifact_comment', excerpt: 'x' })).line1[2]).toEqual(
      plain('an artifact that was deleted')
    );
    expect(
      describeNotification(view({ type: 'team_invite', work_item_id: null })).line1[2]
    ).toEqual(plain('a team that was deleted'));
  });

  it('refuses a role it does not know', () => {
    expect(() => describeNotification(view({ excerpt: 'owner' }))).toThrow(/role/);
  });
});

describe('notificationPlainText', () => {
  it('joins line 1 into a title and uses line 2 as the body', () => {
    expect(
      notificationPlainText(
        describeNotification(view({ type: 'new_message', message_id: 'm1', excerpt: 'hi' }))
      )
    ).toEqual({ title: 'Raghav sent a message in Landing page copy', body: '“hi”' });
  });
});
