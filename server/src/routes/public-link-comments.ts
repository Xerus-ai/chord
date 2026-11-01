import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { resolvePublicLink } from '../access/resolve-public-link.js';
import { db } from '../db/client.js';
import { artifactComments } from '../db/schema-artifacts.js';
import { users } from '../db/schema.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { notifyArtifactComment } from '../notifications/notify-artifact-comment.js';
import { artifactRoomId, workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

const PublicCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  parent_comment_id: z.string().nullable().optional(),
});

/**
 * Comments through a public link (P6): anyone signed in to Chord — a free
 * account, no seat, no membership — reads and writes comments under their own
 * name, from the desktop's public-artifact viewer. The link must resolve
 * (resolvePublicLink) and the author must not have turned comments off for it.
 * Mounted after requireAuth at /public-links/:token/comments.
 */
export function createPublicLinkCommentsRouter(connectionManager: ConnectionManager): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req: Request<{ token: string }>, res) => {
    const target = await resolvePublicLink(req.params.token);
    if (!target) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const comments = await db
      .select()
      .from(artifactComments)
      .where(eq(artifactComments.artifact_id, target.artifactId))
      .orderBy(desc(artifactComments.created_at));
    res.json(comments);
  });

  router.post('/', async (req: Request<{ token: string }>, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const target = await resolvePublicLink(req.params.token);
    if (!target) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (!target.commentsEnabled) {
      res.status(403).json({ error: 'The author turned comments off', code: 'COMMENTS_OFF' });
      return;
    }
    const parsed = PublicCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const [author] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, user.userId))
      .limit(1);
    if (!author) throw new Error(`[public-comments] signed-in user ${user.userId} has no user row`);

    const id = randomUUID();
    const [created] = await db
      .insert(artifactComments)
      .values({
        id,
        artifact_id: target.artifactId,
        parent_comment_id: parsed.data.parent_comment_id ?? null,
        author_id: user.userId,
        author_name: author.name ?? author.email,
        body: parsed.data.body,
      })
      .returning();

    const event = {
      type: 'comment_created' as const,
      payload: {
        work_item_id: target.workItemId,
        artifact_id: target.artifactId,
        comment_id: id,
        author_id: user.userId,
      },
    };
    connectionManager.broadcastToRoom(workItemRoomId(target.workItemId), event);
    connectionManager.broadcastToRoom(artifactRoomId(target.artifactId), event);
    await notifyArtifactComment(connectionManager, {
      workItemId: target.workItemId,
      artifactId: target.artifactId,
      commentId: id,
      commenterId: user.userId,
      body: parsed.data.body,
    });
    res.status(201).json(created);
  });

  return router;
}
