import { and, desc, eq, inArray } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { invalidateWorkItemAccess } from '../access/access-cache.js';
import {
  artifactsOnlyOf,
  requireArtifactRole,
  requireWorkItemRole,
} from '../access/access-middleware.js';
import { recordAccessEvent } from '../access/record-access-event.js';
import { isKnownContentType, renderClassForContentType } from '../artifact-render-class.js';
import { db } from '../db/client.js';
import { artifacts, yjsDocuments } from '../db/schema-artifacts.js';
import { disconnectArtifactDocument } from '../hocuspocus-connections.js';
import { ARTIFACT_DOC_PREFIX } from '../hocuspocus.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { artifactRoomId, workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

interface WorkItemParams {
  work_item_id: string;
}

interface ArtifactParams extends WorkItemParams {
  artifact_id: string;
}

const RegisterArtifactSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  content_type: z.string().default('markdown'),
  render_class: z.enum(['document', 'page', 'file']).optional(),
  // The owner's status (devstation-664). Optional: an older desktop build
  // sends none, which leaves a stored status as it is.
  status: z.enum(['draft', 'in_review', 'approved', 'built']).optional(),
});

/** A work item's artifacts: list, register, delete. Mounted at /work-items/:work_item_id/artifacts. */
export function createWorkItemArtifactsRouter(connectionManager: ConnectionManager): Router {
  const router = Router({ mergeParams: true });

  // Someone an artifact was shared with alone lists just those artifacts.
  router.get(
    '/',
    requireWorkItemRole('view', { allowArtifactsOnly: true }),
    async (req: Request<WorkItemParams>, res) => {
      const reachable = artifactsOnlyOf(req);
      const items = await db
        .select()
        .from(artifacts)
        .where(
          reachable === null
            ? eq(artifacts.work_item_id, req.params.work_item_id)
            : and(
                eq(artifacts.work_item_id, req.params.work_item_id),
                inArray(artifacts.id, reachable)
              )
        )
        .orderBy(desc(artifacts.updated_at));

      res.json(items);
    }
  );

  // Registers an artifact's metadata so its collaboration document
  // (artifact-{id}) can be resolved to this work item for per-document
  // authorization. Idempotent: re-registration updates name/content_type/
  // render_class, and status when sent. The render class is DERIVED from content_type here — the
  // server decides which artifacts get a Yjs room, so an older desktop build
  // that sends no render_class still cannot open a room for a web page, and a
  // client that sends one contradicting the content type is refused rather
  // than believed. A row that just became a page has its open room closed.
  router.post('/', requireWorkItemRole('edit'), async (req: Request<WorkItemParams>, res) => {
    const work_item_id = req.params.work_item_id;
    const parsed = RegisterArtifactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    if (!isKnownContentType(parsed.data.content_type)) {
      res.status(400).json({ error: `Unknown content_type: ${parsed.data.content_type}` });
      return;
    }
    const render_class = renderClassForContentType(parsed.data.content_type);
    if (parsed.data.render_class && parsed.data.render_class !== render_class) {
      res.status(400).json({
        error: `render_class '${parsed.data.render_class}' contradicts content_type '${parsed.data.content_type}' (${render_class})`,
      });
      return;
    }

    // An existing artifact id must not be rebound to a different work item —
    // that would let a caller re-scope someone else's document to a work item
    // they control.
    const [existing] = await db
      .select({ work_item_id: artifacts.work_item_id, render_class: artifacts.render_class })
      .from(artifacts)
      .where(eq(artifacts.id, parsed.data.id))
      .limit(1);

    if (existing && existing.work_item_id !== work_item_id) {
      res.status(409).json({ error: 'Artifact is bound to another work item' });
      return;
    }

    await db
      .insert(artifacts)
      .values({
        id: parsed.data.id,
        work_item_id,
        name: parsed.data.name,
        content_type: parsed.data.content_type,
        render_class,
        status: parsed.data.status ?? null,
      })
      .onConflictDoUpdate({
        target: artifacts.id,
        set: {
          name: parsed.data.name,
          content_type: parsed.data.content_type,
          render_class,
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          updated_at: new Date(),
        },
      });

    if (existing && existing.render_class === 'document' && render_class !== 'document') {
      disconnectArtifactDocument(parsed.data.id);
    }

    const event = {
      type: 'artifact_registered' as const,
      payload: { work_item_id, artifact_id: parsed.data.id },
    };
    connectionManager.broadcastToRoom(workItemRoomId(work_item_id), event);

    res.status(201).json({
      id: parsed.data.id,
      work_item_id,
      name: parsed.data.name,
      content_type: parsed.data.content_type,
      render_class,
    });
  });

  // Deletes the artifact for everyone (P6). Author only. Members, the public
  // link, comments and versions go by cascade; the collaboration document is
  // keyed by name, not a foreign key, so it is removed here, after its open
  // connections are closed. The audit row stays. The author's file on disk
  // is the desktop's business and is left alone.
  router.delete(
    '/:artifact_id',
    requireArtifactRole('author'),
    async (req: Request<ArtifactParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const { work_item_id: workItemId, artifact_id: artifactId } = req.params;

      disconnectArtifactDocument(artifactId);
      await db.batch([
        db.delete(artifacts).where(eq(artifacts.id, artifactId)),
        db
          .delete(yjsDocuments)
          .where(eq(yjsDocuments.document_name, `${ARTIFACT_DOC_PREFIX}${artifactId}`)),
      ]);
      invalidateWorkItemAccess(workItemId);
      await recordAccessEvent({
        workItemId,
        artifactId,
        actorId: user.userId,
        action: 'artifact_deleted',
      });

      const event = {
        type: 'artifact_deleted' as const,
        payload: { work_item_id: workItemId, artifact_id: artifactId },
      };
      connectionManager.broadcastToRoom(workItemRoomId(workItemId), event);
      connectionManager.broadcastToRoom(artifactRoomId(artifactId), event);
      res.status(204).end();
    }
  );

  return router;
}
