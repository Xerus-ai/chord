import { Router } from 'express';
import {
  computeArtifactAccess,
  queryArtifactAccessRows,
  resolveArtifactAccess,
  type ArtifactAccessRow,
} from '../access/resolve-access.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

function describeArtifact(row: ArtifactAccessRow) {
  return {
    id: row.artifact_id,
    work_item_id: row.work_item_id,
    work_item_name: row.work_item_name,
    name: row.name,
    content_type: row.content_type,
    render_class: row.render_class,
    general_access: row.artifact_general_access,
    general_role: row.artifact_general_role,
    updated_at: row.updated_at,
  };
}

/**
 * Artifacts addressed on their own (P6): someone an artifact was shared with
 * alone cannot list its work item's artifacts, so this is how they find and
 * open it. Access-scoped like everything else — 404 when there is none.
 */
export function createArtifactsRouter(): Router {
  const router = Router();

  // Artifacts reached through their own access only — the ones the caller
  // could not find through a work item they are on.
  router.get('/shared-with-me', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const rows = await queryArtifactAccessRows(user.userId, { sharedWithUser: true });

    const shared = rows.flatMap((row) => {
      const access = computeArtifactAccess(row, user.userId);
      if (!access || access.work_item_role !== null) return [];
      return [{ ...describeArtifact(row), caller_role: access.role }];
    });
    res.json(shared);
  });

  router.get('/:artifact_id', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const artifactId = req.params.artifact_id as string;
    const access = await resolveArtifactAccess(user.userId, artifactId);
    if (access === null || access === 'not_found') {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    const [row] = await queryArtifactAccessRows(user.userId, { artifactId });
    if (!row) throw new Error(`[artifacts] artifact vanished mid-request: ${artifactId}`);

    res.json({
      ...describeArtifact(row),
      caller_role: access.role,
      work_item_role: access.work_item_role,
    });
  });

  return router;
}
