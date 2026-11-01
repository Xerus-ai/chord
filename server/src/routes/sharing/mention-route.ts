import { and, eq } from 'drizzle-orm';
import type { Router } from 'express';
import { z } from 'zod';
import { listWorkItemAudience } from '../../access/work-item-audience.js';
import { db } from '../../db/client.js';
import { artifactComments, artifacts } from '../../db/schema-artifacts.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { insertNotifications } from '../../notifications/insert-notifications.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import type { ResourceScope } from './resource-scope.js';

// Where the mention was written, so a click opens it: a chat message, or an
// artifact comment. Neither is a mention in a comment that is stored only on
// the author's machine (its artifact is not in the cloud yet).
const MentionSchema = z
  .object({
    user_ids: z.array(z.string()).min(1),
    excerpt: z.string().min(1),
    message_id: z.string().min(1).optional(),
    comment_id: z.string().min(1).optional(),
  })
  .refine((body) => !(body.message_id && body.comment_id), {
    message: 'A mention is in a message or in a comment, not both',
  });

/**
 * "You were mentioned", in chat or in an artifact comment. Commenting is part
 * of Can view, so any role may mention; only people with access to the work
 * item are notified — a mention never reaches someone the item is not shared
 * with, and never shares it.
 */
export function registerMentionRoute(
  router: Router,
  scope: ResourceScope,
  connectionManager: ConnectionManager
): void {
  router.post('/mentions', scope.requireRole('view'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const parsed = MentionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { workItemId } = scope.refOf(req);
    const { message_id: messageId, comment_id: commentId } = parsed.data;

    let artifactId: string | undefined;
    if (commentId) {
      const [comment] = await db
        .select({ artifact_id: artifactComments.artifact_id })
        .from(artifactComments)
        .innerJoin(artifacts, eq(artifacts.id, artifactComments.artifact_id))
        .where(and(eq(artifactComments.id, commentId), eq(artifacts.work_item_id, workItemId)))
        .limit(1);
      if (!comment) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      artifactId = comment.artifact_id;
    }

    const audience = new Set(await listWorkItemAudience(workItemId));
    const targets = [...new Set(parsed.data.user_ids)].filter(
      (id) => id !== user.userId && audience.has(id)
    );

    await insertNotifications(
      connectionManager,
      targets.map((targetId) => ({
        user_id: targetId,
        type: 'mentioned' as const,
        actor_user_id: user.userId,
        work_item_id: workItemId,
        artifact_id: artifactId,
        comment_id: commentId,
        message_id: messageId,
        excerpt: parsed.data.excerpt,
      }))
    );
    res.status(targets.length === 0 ? 200 : 201).json({ notified: targets.length });
  });
}
