import { describe, expect, it } from 'vitest';
import { clickForNotification, type NotificationClickFacts } from './notification-navigation';

function facts(overrides: Partial<NotificationClickFacts>): NotificationClickFacts {
  return {
    type: 'shared_with_you',
    work_item_id: 'wi1',
    artifact_id: null,
    comment_id: null,
    message_id: null,
    ...overrides,
  };
}

/**
 * Where a notification row click goes (shared-items step 2, N4). An artifact
 * opens through the artifact-link view, which sends everyone to the artifact's
 * tab in its work item: the whole item, or the item scoped to the artifacts
 * shared with them (step 4, S9). A comment opens that tab with its thread
 * selected.
 */
describe('clickForNotification', () => {
  it('a shared work item opens the work item', () => {
    expect(clickForNotification(facts({}))).toEqual({
      target: { view: 'work-list', params: { workItemId: 'wi1' } },
      commentCard: null,
    });
  });

  it('a shared artifact opens that artifact', () => {
    expect(clickForNotification(facts({ artifact_id: 'art1' }))).toEqual({
      target: { view: 'artifact-link', params: { artifactId: 'art1' } },
      commentCard: null,
    });
  });

  // Step 5: a chat notification opens the work item on the message itself,
  // which the view resolves (its chat, whether it is still there) on arrival.
  it('a chat mention opens the work item to reveal its message', () => {
    expect(clickForNotification(facts({ type: 'mentioned', message_id: 'm1' }))).toEqual({
      target: {
        view: 'work-list',
        params: { workItemId: 'wi1', revealMessage: { workItemId: 'wi1', messageId: 'm1' } },
      },
      commentCard: null,
    });
  });

  it('a new message opens the work item to reveal it', () => {
    expect(clickForNotification(facts({ type: 'new_message', message_id: 'm1' }))).toEqual({
      target: {
        view: 'work-list',
        params: { workItemId: 'wi1', revealMessage: { workItemId: 'wi1', messageId: 'm1' } },
      },
      commentCard: null,
    });
  });

  it('a chat notification naming no message opens the work item', () => {
    expect(clickForNotification(facts({ type: 'mentioned' }))).toEqual({
      target: { view: 'work-list', params: { workItemId: 'wi1' } },
      commentCard: null,
    });
  });

  it('a share never reveals a message, whatever the row carries', () => {
    expect(clickForNotification(facts({ message_id: 'm1' }))).toEqual({
      target: { view: 'work-list', params: { workItemId: 'wi1' } },
      commentCard: null,
    });
  });

  it('a mention in a comment opens the artifact with that thread in the comments card', () => {
    expect(
      clickForNotification(facts({ type: 'mentioned', artifact_id: 'art1', comment_id: 'c1' }))
    ).toEqual({
      target: { view: 'artifact-link', params: { artifactId: 'art1' } },
      commentCard: { artifactId: 'art1', commentId: 'c1' },
    });
  });

  it('a comment on your artifact opens the artifact with that thread in the comments card', () => {
    expect(
      clickForNotification(
        facts({ type: 'artifact_comment', artifact_id: 'art1', comment_id: 'c1' })
      )
    ).toEqual({
      target: { view: 'artifact-link', params: { artifactId: 'art1' } },
      commentCard: { artifactId: 'art1', commentId: 'c1' },
    });
  });

  it('a comment deleted since opens the comments card with no thread selected', () => {
    expect(
      clickForNotification(
        facts({ type: 'artifact_comment', artifact_id: 'art1', comment_id: null })
      )
    ).toEqual({
      target: { view: 'artifact-link', params: { artifactId: 'art1' } },
      commentCard: { artifactId: 'art1', commentId: null },
    });
  });

  it('a comment on an artifact deleted since opens its work item', () => {
    expect(clickForNotification(facts({ type: 'artifact_comment', artifact_id: null }))).toEqual({
      target: { view: 'work-list', params: { workItemId: 'wi1' } },
      commentCard: null,
    });
  });

  it('a team invite goes nowhere: it is accepted in the row', () => {
    expect(clickForNotification(facts({ type: 'team_invite', work_item_id: null }))).toBeNull();
  });

  it('a share whose work item was deleted goes nowhere', () => {
    expect(clickForNotification(facts({ work_item_id: null }))).toBeNull();
  });
});
