import type { NotificationView } from '@chord/protocol';
import type { OpenTargetNavigation } from '@renderer/features/deep-links/deep-link-navigation';

export type NotificationClickFacts = Pick<
  NotificationView,
  'type' | 'work_item_id' | 'artifact_id' | 'comment_id' | 'message_id'
>;

export interface NotificationClick {
  target: OpenTargetNavigation;
  /** Open the artifact's comments card, on the thread holding this comment. */
  commentCard: { artifactId: string; commentId: string | null } | null;
}

/**
 * Where a notification row click goes. An artifact opens through the
 * artifact-link view, which sends everyone to the artifact's tab in its work
 * item: the whole item, or the item scoped to the artifacts shared with them. A
 * chat notification opens the work item on its message (step 5): the view
 * reads the message on arrival, opens the chat holding it and scrolls to it. A
 * team invite is accepted in its row, so it goes nowhere.
 */
export function clickForNotification(n: NotificationClickFacts): NotificationClick | null {
  switch (n.type) {
    case 'team_invite':
      return null;
    case 'shared_with_you':
      return openArtifactOrWorkItem(n, { withComments: false, inChat: false });
    case 'new_message':
      return openArtifactOrWorkItem(n, { withComments: false, inChat: true });
    case 'mentioned':
      return openArtifactOrWorkItem(n, { withComments: true, inChat: true });
    case 'artifact_comment':
      return openArtifactOrWorkItem(n, { withComments: true, inChat: false });
  }
}

function openArtifactOrWorkItem(
  n: NotificationClickFacts,
  { withComments, inChat }: { withComments: boolean; inChat: boolean }
): NotificationClick | null {
  if (n.artifact_id) {
    return {
      target: { view: 'artifact-link', params: { artifactId: n.artifact_id } },
      commentCard: withComments ? { artifactId: n.artifact_id, commentId: n.comment_id } : null,
    };
  }
  if (n.work_item_id) {
    const revealMessage =
      inChat && n.message_id ? { workItemId: n.work_item_id, messageId: n.message_id } : null;
    return {
      target: {
        view: 'work-list',
        params: revealMessage
          ? { workItemId: n.work_item_id, revealMessage }
          : { workItemId: n.work_item_id },
      },
      commentCard: null,
    };
  }
  return null;
}
