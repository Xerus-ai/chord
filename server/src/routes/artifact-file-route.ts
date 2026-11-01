import type { Request, Router } from 'express';
import { requireArtifactRole } from '../access/access-middleware.js';
import { selectArtifactFile } from '../artifact-version-reads.js';

interface ArtifactParams {
  work_item_id: string;
  artifact_id: string;
}

/**
 * GET …/artifacts/:artifact_id/file[?version_id=] — a file artifact's bytes
 * (P6 §10): the latest version that still has them, or the named version.
 * Artifact access is enough. 404 { error: 'no_file' } when there is none.
 */
export function registerArtifactFileRoute(router: Router): void {
  router.get(
    '/:artifact_id/file',
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const versionId = req.query.version_id;
      if (versionId !== undefined && typeof versionId !== 'string') {
        res.status(400).json({ error: '`version_id` must be a single version id' });
        return;
      }
      const file = await selectArtifactFile(
        req.params.artifact_id,
        req.params.work_item_id,
        versionId ?? null
      );
      if (!file) {
        res.status(404).json({ error: 'no_file' });
        return;
      }
      const { content_base64, ...metadata } = file;
      res.json({ ...metadata, file_base64: content_base64 });
    }
  );
}
