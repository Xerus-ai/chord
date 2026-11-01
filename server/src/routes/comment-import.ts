import {
  ArtifactCommentImportSchema,
  type ArtifactCommentImportResult,
  type CommentCreatedServerEvent,
} from '@chord/protocol';
import { Router, type Request } from 'express';
import { requireArtifactRole } from '../access/access-middleware.js';
import { db, hasDb } from '../db/client.js';
import { artifactComments } from '../db/schema-artifacts.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { artifactRoomId, workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

interface ArtifactParams {
  work_item_id: string;
  artifact_id: string;
}

/**
 * Comments written on the author's device before the artifact first reached
 * the cloud (devstation-85y): the desktop imports them once it has registered
 * the artifact, so the comments card, which reads the cloud from then on,
 * still shows them. Ids, parents, anchors, resolved state and times are kept;
 * the caller is the author. A retry inserts only the comments the cloud lacks
 * and changes none it has. These are history, not new activity: nobody is
 * notified, and one thin ping lets open cards refetch.
 */
export function createCommentImportRouter(connectionManager: ConnectionManager): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/:artifact_id/comments/import',
    (_req, res, next) => {
      if (!hasDb) {
        res.status(503).json({ error: 'Database not available in local dev mode' });
        return;
      }
      next();
    },
    // Registering the artifact needs edit; so does bringing its history along.
    requireArtifactRole('edit'),
    async (req: Request<ArtifactParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;
      const parsed = ArtifactCommentImportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const inserted = await db
        .insert(artifactComments)
        .values(
          parsed.data.comments.map((comment) => ({
            id: comment.id,
            artifact_id: artifactId,
            parent_comment_id: comment.parent_comment_id,
            author_id: user.userId,
            author_name: user.email,
            anchor_key: comment.anchor_key,
            anchor_text: comment.anchor_text,
            body: comment.body,
            resolved: comment.resolved,
            resolved_by: comment.resolved ? user.userId : null,
            created_at: new Date(comment.created_at),
          }))
        )
        .onConflictDoNothing({ target: artifactComments.id })
        .returning({ id: artifactComments.id });

      const last = inserted.at(-1);
      if (last) {
        const event: CommentCreatedServerEvent = {
          type: 'comment_created',
          payload: {
            work_item_id: workItemId,
            artifact_id: artifactId,
            comment_id: last.id,
            author_id: user.userId,
          },
        };
        connectionManager.broadcastToRoom(workItemRoomId(workItemId), event);
        connectionManager.broadcastToRoom(artifactRoomId(artifactId), event);
      }

      const body: ArtifactCommentImportResult = { imported: inserted.length };
      res.json(body);
    }
  );

  return router;
}
