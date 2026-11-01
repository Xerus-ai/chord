import type { Request, Router } from 'express';
import { requireArtifactRole } from '../access/access-middleware.js';
import { selectArtifactView } from '../artifact-version-reads.js';

interface ArtifactParams {
  work_item_id: string;
  artifact_id: string;
}

/**
 * GET …/artifacts/:artifact_id/view[?version_id=] — how everyone but the
 * author sees a page (P6 §9): the self-contained view uploaded with the
 * latest version that still has one, or with the named version. Artifact
 * access is enough, so a person the artifact alone was shared with reads it.
 * 404 { error: 'no_view' } when there is none — a document never has one.
 */
export function registerArtifactViewRoute(router: Router): void {
  router.get(
    '/:artifact_id/view',
    requireArtifactRole('view'),
    async (req: Request<ArtifactParams>, res) => {
      const versionId = req.query.version_id;
      if (versionId !== undefined && typeof versionId !== 'string') {
        res.status(400).json({ error: '`version_id` must be a single version id' });
        return;
      }
      const view = await selectArtifactView(
        req.params.artifact_id,
        req.params.work_item_id,
        versionId ?? null
      );
      if (!view) {
        res.status(404).json({ error: 'no_view' });
        return;
      }
      res.json(view);
    }
  );
}
