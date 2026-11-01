import { and, desc, eq, inArray } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import * as Y from 'yjs';
import { z } from 'zod';
import { requireArtifactRole } from '../access/access-middleware.js';
import {
  selectVersionMetadata,
  versionAuthorJoin,
  versionMetadataColumns,
} from '../artifact-version-reads.js';
import {
  saveFileVersion,
  savePageSourceVersion,
  type VersionInsertResult,
} from '../artifact-version-rows.js';
import { db, hasDb } from '../db/client.js';
import { artifacts, artifactVersions } from '../db/schema-artifacts.js';
import { users } from '../db/schema.js';
import {
  readCurrentDocumentState,
  readVersionSnapshot,
  saveVersionSnapshot,
} from '../hocuspocus.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { announceVersionCreated } from './announce-version-created.js';
import { registerArtifactFileRoute } from './artifact-file-route.js';
import { registerArtifactViewRoute } from './artifact-view.js';
import { parseFileVersionBody } from './file-version-body.js';
import { xmlFragmentToHtml } from './version-snapshot-html.js';

interface ArtifactParams {
  work_item_id: string;
  artifact_id: string;
}

interface VersionParams extends ArtifactParams {
  version_id: string;
}

/** A page view's cap (P6 §9 decision 5), in UTF-8 bytes. */
const MAX_VIEW_BYTES = 8 * 1024 * 1024;

// Gated per artifact (requireArtifactRole): artifact access is inherited
// from the work item or granted on the artifact alone, and the gate refuses
// an :artifact_id that does not belong to :work_item_id. Queries still scope
// by both ids so a :version_id can never reach another artifact's versions.
function scopedArtifactId(artifactId: string, workItemId: string) {
  return db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.id, artifactId), eq(artifacts.work_item_id, workItemId)));
}

// `content` is the page source and `view_html` the self-contained view the
// author's app built from it (P6 §9); both are required for a page artifact.
// A document artifact is versioned from its Yjs state and must send neither.
// A file artifact (P6 §10) sends `file_base64` + `mime_type`, and `view_html`
// for an image or docx (file-version-body.ts).
// `base_version` is the version the save was made on (0 for none yet): a save
// on a stale base is refused with 409 instead of interleaving (plan P4 step 3).
// `client_version_id` makes an upload idempotent: the desktop's sync_queue
// retries it, and a repeat answers with the stored row.
const CreateVersionSchema = z.object({
  label: z.string().optional(),
  content: z.string().optional(),
  view_html: z.string().optional(),
  file_base64: z.string().optional(),
  mime_type: z.string().optional(),
  base_version: z.number().int().nonnegative().optional(),
  trigger: z.enum(['manual', 'agent_milestone']).default('manual'),
  client_version_id: z.string().min(1).optional(),
});

export function createVersionsRouter(connectionManager: ConnectionManager): Router {
  const router = Router({ mergeParams: true });

  router.use((_req, res, next) => {
    if (!hasDb) {
      res.status(503).json({ error: 'Database not available in local dev mode' });
      return;
    }
    next();
  });

  async function respondToVersionSave(
    res: Response,
    workItemId: string,
    result: VersionInsertResult
  ): Promise<void> {
    if (result.status === 'conflict') {
      res.status(409).json({ error: 'conflict', latest_version: result.latestVersion });
      return;
    }
    const version = await selectVersionMetadata(result.versionId);
    if (result.status === 'saved') announceVersionCreated(connectionManager, workItemId, version);
    res.status(result.status === 'saved' ? 201 : 200).json(version);
  }

  router.get(
    '/:artifact_id/versions',
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;

      const versions = await db
        .select(versionMetadataColumns)
        .from(artifactVersions)
        .leftJoin(users, versionAuthorJoin)
        .where(inArray(artifactVersions.artifact_id, scopedArtifactId(artifactId, workItemId)))
        .orderBy(desc(artifactVersions.version_number));

      res.json(versions);
    }
  );

  router.get(
    '/:artifact_id/versions/:version_id',
    requireArtifactRole('view'),
    async (req: Request<VersionParams>, res) => {
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;

      const [version] = await db
        .select(versionMetadataColumns)
        .from(artifactVersions)
        .leftJoin(users, versionAuthorJoin)
        .where(
          and(
            eq(artifactVersions.id, req.params.version_id),
            inArray(artifactVersions.artifact_id, scopedArtifactId(artifactId, workItemId))
          )
        )
        .limit(1);

      if (!version) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }

      res.json(version);
    }
  );

  router.get(
    '/:artifact_id/versions/:version_id/snapshot',
    requireArtifactRole('view'),
    async (req: Request<VersionParams>, res) => {
      const {
        artifact_id: artifactId,
        work_item_id: workItemId,
        version_id: versionId,
      } = req.params;

      const [version] = await db
        .select({
          document_name: artifactVersions.document_name,
          byte_size: artifactVersions.byte_size,
          content: artifactVersions.content,
          render_class: artifacts.render_class,
        })
        .from(artifactVersions)
        .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifact_id))
        .where(
          and(
            eq(artifactVersions.id, versionId),
            eq(artifacts.id, artifactId),
            eq(artifacts.work_item_id, workItemId)
          )
        )
        .limit(1);

      if (!version) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }

      if (version.render_class === 'page') {
        if (version.content === null) {
          throw new Error(`Page artifact version ${versionId} has no stored source`);
        }
        res.json({ source: version.content, byte_size: version.byte_size });
        return;
      }

      if (version.render_class === 'file') {
        res.status(400).json({
          error: 'A file version has no snapshot; its bytes are served by …/file?version_id=',
        });
        return;
      }

      const data = await readVersionSnapshot(version.document_name, versionId);
      if (!data) {
        res.status(404).json({ error: 'Snapshot file not found' });
        return;
      }

      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, data);

      const xmlFragment = ydoc.getXmlFragment('default');
      const html = xmlFragmentToHtml(xmlFragment);
      ydoc.destroy();

      res.json({ html, byte_size: data.byteLength });
    }
  );

  registerArtifactViewRoute(router);
  registerArtifactFileRoute(router);

  router.post(
    '/:artifact_id/versions',
    requireArtifactRole('edit'),
    async (req: Request<ArtifactParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const { artifact_id: artifactId, work_item_id: workItemId } = req.params;
      const parsed = CreateVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }
      const { label, content, view_html: viewHtml, trigger } = parsed.data;
      const baseVersion = parsed.data.base_version ?? null;
      const clientVersionId = parsed.data.client_version_id ?? null;

      const [artifact] = await db
        .select({
          id: artifacts.id,
          render_class: artifacts.render_class,
          content_type: artifacts.content_type,
        })
        .from(artifacts)
        .where(and(eq(artifacts.id, artifactId), eq(artifacts.work_item_id, workItemId)))
        .limit(1);

      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      if (artifact.render_class === 'file') {
        const file = parseFileVersionBody(artifact.content_type, parsed.data);
        if (!file.ok) {
          res.status(file.status).json(file.body);
          return;
        }
        const saved = await saveFileVersion({
          artifactId,
          mimeType: file.mimeType,
          contentBase64: file.contentBase64,
          byteSize: file.byteSize,
          viewHtml: file.viewHtml,
          authorId: user.userId,
          authorName: user.email,
          label: label ?? null,
          trigger,
          baseVersion,
          clientVersionId,
        });
        await respondToVersionSave(res, workItemId, saved);
        return;
      }

      if (parsed.data.file_base64 !== undefined || parsed.data.mime_type !== undefined) {
        res.status(400).json({
          error: 'Only file artifacts accept `file_base64` and `mime_type`',
        });
        return;
      }

      if (artifact.render_class === 'page') {
        if (!content) {
          res
            .status(400)
            .json({ error: 'A page artifact version requires `content`: the page source text' });
          return;
        }
        if (viewHtml === undefined) {
          res.status(400).json({
            error: 'A page artifact version requires `view_html`: the view built from its source',
          });
          return;
        }
        if (Buffer.byteLength(viewHtml, 'utf8') > MAX_VIEW_BYTES) {
          res.status(413).json({ error: 'view_too_large', max_bytes: MAX_VIEW_BYTES });
          return;
        }
        const saved = await savePageSourceVersion({
          artifactId,
          source: content,
          viewHtml,
          authorId: user.userId,
          authorName: user.email,
          label: label ?? null,
          trigger,
          baseVersion,
          clientVersionId,
        });
        await respondToVersionSave(res, workItemId, saved);
        return;
      }

      if (content !== undefined || viewHtml !== undefined) {
        res.status(400).json({
          error:
            'Only page artifacts accept `content` and `view_html`; this artifact is versioned from its document',
        });
        return;
      }

      const documentName = `artifact-${artifactId}`;
      const update = await readCurrentDocumentState(documentName);
      if (!update) {
        res.status(404).json({ error: 'No document found for this artifact' });
        return;
      }

      const saved = await saveVersionSnapshot({
        documentName,
        update,
        authorId: user.userId,
        authorName: user.email,
        trigger,
        label: label ?? null,
        baseVersion,
        clientVersionId,
      });
      await respondToVersionSave(res, workItemId, saved);
    }
  );

  return router;
}
