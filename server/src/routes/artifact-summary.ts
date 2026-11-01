import { sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

interface WorkItemParams {
  work_item_id: string;
}

// A type, not an interface: db.execute's row type must index as a record.
export type ArtifactSummaryRow = {
  artifact_id: string;
  /** Unresolved threads: root comments, as the comments card counts them. */
  open_comments: number;
  /** Another person commented after the caller last read (PUT .../comments/read). */
  unread: boolean;
  /** The newest version number, or null for an artifact with no versions. */
  latest_version: number | null;
};

/**
 * The rail's counts for a work item's artifacts (shared-items step 1, S8), in
 * one grouped query rather than a request per row. Mounted at
 * /work-items/:work_item_id/artifact-summary.
 */
export function createArtifactSummaryRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', requireWorkItemRole('view'), async (req: Request<WorkItemParams>, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const workItemId = req.params.work_item_id;

    // Versions are grouped on their own so their rows never multiply the
    // comment rows the counts are taken over.
    const result = await db.execute<ArtifactSummaryRow>(sql`
      SELECT
        a.id AS artifact_id,
        (count(c.id) FILTER (
          WHERE c.parent_comment_id IS NULL AND c.resolved IS NOT TRUE
        ))::integer AS open_comments,
        COALESCE(bool_or(
          c.author_id <> ${user.userId}
          AND (r.last_read_at IS NULL OR c.created_at > r.last_read_at)
        ), false) AS unread,
        v.latest_version
      FROM artifacts a
      LEFT JOIN artifact_comment_reads r
        ON r.artifact_id = a.id AND r.user_id = ${user.userId}
      LEFT JOIN artifact_comments c ON c.artifact_id = a.id
      LEFT JOIN (
        SELECT artifact_id, MAX(version_number)::integer AS latest_version
        FROM artifact_versions
        WHERE artifact_id IN (SELECT id FROM artifacts WHERE work_item_id = ${workItemId})
        GROUP BY artifact_id
      ) v ON v.artifact_id = a.id
      WHERE a.work_item_id = ${workItemId}
      GROUP BY a.id, r.last_read_at, v.latest_version
      ORDER BY a.id
    `);

    res.json(result.rows);
  });

  return router;
}
