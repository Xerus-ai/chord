import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workItems } from '../db/schema.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { insertNotifications } from './insert-notifications.js';

export interface ArtifactCommentMade {
  workItemId: string;
  artifactId: string;
  commentId: string;
  commenterId: string;
  body: string;
}

/**
 * "Comment on your artifact": tells the work item's author, who authors every
 * artifact in it (artifacts have no creator of their own), that someone else
 * commented. Written for every such comment; whether it is shown is the
 * author's local preference. The commenter is named even through a public
 * link: that route requires sign-in and the comment already carries the name.
 */
export async function notifyArtifactComment(
  manager: ConnectionManager,
  made: ArtifactCommentMade
): Promise<void> {
  const [item] = await db
    .select({ creator_id: workItems.creator_id })
    .from(workItems)
    .where(eq(workItems.id, made.workItemId))
    .limit(1);
  if (!item) throw new Error(`[notifications] work item ${made.workItemId} vanished mid-comment`);
  if (item.creator_id === made.commenterId) return;

  await insertNotifications(manager, [
    {
      user_id: item.creator_id,
      type: 'artifact_comment',
      actor_user_id: made.commenterId,
      work_item_id: made.workItemId,
      artifact_id: made.artifactId,
      comment_id: made.commentId,
      excerpt: made.body,
    },
  ]);
}
