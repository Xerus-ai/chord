import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/client.js';
import { artifacts } from '../../db/schema-artifacts.js';
import { resourceMembers, shareLinks } from '../../db/schema-sharing.js';
import { workItems } from '../../db/schema.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { toShareLinkView } from './share-links.js';

export interface SharedByMeRow {
  kind: 'work_item' | 'artifact';
  work_item_id: string;
  artifact_id: string | null;
  name: string;
  general_access: string;
  general_role: string;
  /** Members of this resource itself, pending invites included. */
  member_count: number;
  link_url: string | null;
  updated_at: Date;
}

/**
 * GET /sharing/shared-by-me — You › Sharing: every work item and artifact the
 * caller authored that someone else can open (members, team access or a
 * public link), newest first. Two grouped queries, whatever the count.
 */
export function createSharedByMeRouter(): Router {
  const router = Router();

  router.get('/shared-by-me', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;

    const memberCount = count(resourceMembers.id);
    const workItemRows = await db
      .select({
        id: workItems.id,
        name: workItems.name,
        general_access: workItems.general_access,
        general_role: workItems.general_role,
        updated_at: workItems.updated_at,
        member_count: memberCount,
      })
      .from(workItems)
      .leftJoin(
        resourceMembers,
        and(eq(resourceMembers.work_item_id, workItems.id), isNull(resourceMembers.artifact_id))
      )
      .where(eq(workItems.creator_id, user.userId))
      .groupBy(workItems.id)
      .having(or(eq(workItems.general_access, 'team'), sql`${memberCount} > 0`));

    const artifactRows = await db
      .select({
        id: artifacts.id,
        work_item_id: artifacts.work_item_id,
        name: artifacts.name,
        general_access: artifacts.general_access,
        general_role: artifacts.general_role,
        updated_at: artifacts.updated_at,
        link_id: shareLinks.id,
        link_comments_enabled: shareLinks.comments_enabled,
        member_count: memberCount,
      })
      .from(artifacts)
      .innerJoin(workItems, eq(workItems.id, artifacts.work_item_id))
      .leftJoin(resourceMembers, eq(resourceMembers.artifact_id, artifacts.id))
      .leftJoin(
        shareLinks,
        and(eq(shareLinks.artifact_id, artifacts.id), isNull(shareLinks.revoked_at))
      )
      .where(eq(workItems.creator_id, user.userId))
      .groupBy(artifacts.id, shareLinks.id)
      .having(or(inArray(artifacts.general_access, ['team', 'link']), sql`${memberCount} > 0`));

    const rows: SharedByMeRow[] = [
      ...workItemRows.map((row) => ({
        kind: 'work_item' as const,
        work_item_id: row.id,
        artifact_id: null,
        name: row.name,
        general_access: row.general_access,
        general_role: row.general_role,
        member_count: row.member_count,
        link_url: null,
        updated_at: row.updated_at,
      })),
      ...artifactRows.map((row) => ({
        kind: 'artifact' as const,
        work_item_id: row.work_item_id,
        artifact_id: row.id,
        name: row.name,
        general_access: row.general_access,
        general_role: row.general_role,
        member_count: row.member_count,
        link_url:
          row.link_id !== null && row.link_comments_enabled !== null
            ? toShareLinkView({ id: row.link_id, comments_enabled: row.link_comments_enabled }).url
            : null,
        updated_at: row.updated_at,
      })),
    ];
    // Merged from two queries, so newest-first is applied here.
    rows.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    res.json(rows);
  });

  return router;
}
