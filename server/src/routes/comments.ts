import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireArtifactRole, requireWorkItemRole } from '../access/access-middleware.js';
import { db, hasDb } from '../db/client.js';
import { artifactCommentReads, artifactComments, artifacts } from '../db/schema-artifacts.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { notifyArtifactComment } from '../notifications/notify-artifact-comment.js';
import { artifactRoomId, workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

interface ArtifactParams {
  work_item_id: string;
  artifact_id: string;
}

interface CommentParams extends ArtifactParams {
  comment_id: string;
}

const CreateCommentSchema = z.object({
  parent_comment_id: z.string().nullable().optional(),
  anchor_key: z.string().nullable().optional(),
  anchor_text: z.string().nullable().optional(),
  body: z.string().min(1),
});

export function createCommentsRouter(connectionManager: ConnectionManager) {
  const commentsRouter = Router({ mergeParams: true });

  commentsRouter.use((_req, res, next) => {
    if (!hasDb) {
      res.status(503).json({ error: 'Database not available in local dev mode' });
      return;
    }
    next();
  });

  // Every route is gated per artifact (requireArtifactRole): artifact access
  // is inherited from the work item or granted on the artifact alone, and the
  // gate refuses an :artifact_id that does not belong to :work_item_id. The
  // queries still scope by both ids so a :comment_id can never reach a
  // comment on another artifact. Commenting is part of Can view (P6).
  function scopedArtifactId(artifactId: string, workItemId: string) {
    return db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.work_item_id, workItemId)));
  }

  commentsRouter.get(
    '/:artifact_id/comments',
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;

      const comments = await db
        .select()
        .from(artifactComments)
        .where(inArray(artifactComments.artifact_id, scopedArtifactId(artifactId, workItemId)))
        .orderBy(desc(artifactComments.created_at));

      res.json(comments);
    }
  );

  commentsRouter.get(
    '/:artifact_id/comments/unresolved',
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;

      const unresolvedComments = await db
        .select()
        .from(artifactComments)
        .where(
          and(
            inArray(artifactComments.artifact_id, scopedArtifactId(artifactId, workItemId)),
            eq(artifactComments.resolved, false)
          )
        )
        .orderBy(desc(artifactComments.created_at));

      res.json(unresolvedComments);
    }
  );

  // The caller has read this artifact's comments up to now: another person's
  // comment is unread only if it is newer (artifact-summary.ts). One row per
  // account and artifact, moved forward on every read.
  commentsRouter.put(
    '/:artifact_id/comments/read',
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      await db
        .insert(artifactCommentReads)
        .values({ user_id: user.userId, artifact_id: req.params.artifact_id })
        .onConflictDoUpdate({
          target: [artifactCommentReads.user_id, artifactCommentReads.artifact_id],
          set: { last_read_at: sql`now()` },
        });
      res.status(204).end();
    }
  );

  commentsRouter.post(
    '/:artifact_id/comments',
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;

      const parsed = CreateCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const [artifact] = await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(and(eq(artifacts.id, artifactId), eq(artifacts.work_item_id, workItemId)))
        .limit(1);

      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      const id = randomUUID();

      await db.insert(artifactComments).values({
        id,
        artifact_id: artifactId,
        parent_comment_id: parsed.data.parent_comment_id ?? null,
        author_id: user.userId,
        author_name: user.email,
        anchor_key: parsed.data.anchor_key ?? null,
        anchor_text: parsed.data.anchor_text ?? null,
        body: parsed.data.body,
      });

      const [created] = await db
        .select()
        .from(artifactComments)
        .where(eq(artifactComments.id, id))
        .limit(1);

      // Peers in the work item's room previously only learned about a comment
      // on their next reconnect/reseed. Thin ping — the body never rides the
      // socket; receivers refetch the artifact's comments so the cloud store
      // stays the single source of truth for a cloud artifact.
      // Both rooms: work-item members watch the work item's room, artifact-only
      // members can only join the artifact's.
      const commentEvent = {
        type: 'comment_created' as const,
        payload: {
          work_item_id: workItemId,
          artifact_id: artifactId,
          comment_id: id,
          author_id: user.userId,
        },
      };
      connectionManager.broadcastToRoom(workItemRoomId(workItemId), commentEvent);
      connectionManager.broadcastToRoom(artifactRoomId(artifactId), commentEvent);
      await notifyArtifactComment(connectionManager, {
        workItemId,
        artifactId,
        commentId: id,
        commenterId: user.userId,
        body: parsed.data.body,
      });

      res.status(201).json(created);
    }
  );

  commentsRouter.post(
    '/:artifact_id/comments/:comment_id/resolve',
    requireArtifactRole('edit'),
    async (req: Request<CommentParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const {
        artifact_id: artifactId,
        work_item_id: workItemId,
        comment_id: commentId,
      } = req.params;

      const [comment] = await db
        .select()
        .from(artifactComments)
        .where(
          and(
            eq(artifactComments.id, commentId),
            inArray(artifactComments.artifact_id, scopedArtifactId(artifactId, workItemId))
          )
        )
        .limit(1);

      if (!comment) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }

      await db
        .update(artifactComments)
        .set({ resolved: true, resolved_by: user.userId })
        .where(eq(artifactComments.id, commentId));

      const [updated] = await db
        .select()
        .from(artifactComments)
        .where(eq(artifactComments.id, commentId))
        .limit(1);

      res.json(updated);
    }
  );

  commentsRouter.post(
    '/:artifact_id/comments/:comment_id/unresolve',
    requireArtifactRole('edit'),
    async (req: Request<CommentParams>, res) => {
      const {
        artifact_id: artifactId,
        work_item_id: workItemId,
        comment_id: commentId,
      } = req.params;

      const [comment] = await db
        .select()
        .from(artifactComments)
        .where(
          and(
            eq(artifactComments.id, commentId),
            inArray(artifactComments.artifact_id, scopedArtifactId(artifactId, workItemId))
          )
        )
        .limit(1);

      if (!comment) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }

      await db
        .update(artifactComments)
        .set({ resolved: false, resolved_by: null })
        .where(eq(artifactComments.id, commentId));

      const [updated] = await db
        .select()
        .from(artifactComments)
        .where(eq(artifactComments.id, commentId))
        .limit(1);

      res.json(updated);
    }
  );

  commentsRouter.post(
    '/:artifact_id/comments/add-to-chat',
    // Feeds the agent chat, so it needs Can edit on the work item itself.
    requireWorkItemRole('edit'),
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;

      const comments = await db
        .select()
        .from(artifactComments)
        .where(
          and(
            inArray(artifactComments.artifact_id, scopedArtifactId(artifactId, workItemId)),
            eq(artifactComments.resolved, false)
          )
        )
        .orderBy(desc(artifactComments.created_at));

      if (comments.length === 0) {
        res.json({ markdown: '', count: 0 });
        return;
      }

      const threads = new Map<string | null, typeof comments>();
      for (const c of comments) {
        const threadId = c.parent_comment_id ?? c.id;
        const existing = threads.get(threadId) ?? [];
        existing.push(c);
        threads.set(threadId, existing);
      }

      const lines: string[] = ['## Unresolved Comments\n'];
      for (const [, thread] of threads) {
        const root = thread.find((c) => !c.parent_comment_id) ?? thread[0]!;
        const quote = root.anchor_text ? `> ${root.anchor_text}\n` : '';
        lines.push(`${quote}**${root.author_name}**: ${root.body}`);

        const replies = thread.filter((c) => c.parent_comment_id);
        for (const reply of replies) {
          lines.push(`  - **${reply.author_name}**: ${reply.body}`);
        }
        lines.push('');
      }

      res.json({ markdown: lines.join('\n'), count: comments.length });
    }
  );

  return commentsRouter;
}
