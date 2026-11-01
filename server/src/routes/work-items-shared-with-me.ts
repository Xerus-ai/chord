import { and, desc, eq, exists, isNull, ne, or } from 'drizzle-orm';
import type { Router } from 'express';
import { db } from '../db/client.js';
import { resourceMembers } from '../db/schema-sharing.js';
import { orgMemberships, workItems } from '../db/schema.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  listArtifactsSharedAlone,
  ownerOf,
  readArtifactsOnlyHeaders,
  readWorkItemOwners,
} from './work-item-headers.js';
import { fetchSessionsForWorkItems } from './work-item-sessions.js';
import { fetchWorktreesForWorkItems } from './work-item-worktrees.js';

/**
 * GET /work-items/shared-with-me: every other author's work item the caller
 * reaches, with its owner. With `?include=artifacts`, also each work item
 * reached only through artifacts shared alone, as a header (shared-items
 * design §5, `access_scope: 'artifacts'`).
 */
export function registerSharedWithMeRoute(router: Router): void {
  router.get('/shared-with-me', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;

    // Items reached through the work item itself: a member row, or the
    // item's team access for a member of its org.
    const memberRow = db
      .select({ id: resourceMembers.id })
      .from(resourceMembers)
      .where(
        and(
          eq(resourceMembers.work_item_id, workItems.id),
          isNull(resourceMembers.artifact_id),
          eq(resourceMembers.user_id, user.userId)
        )
      );
    const teamMembership = db
      .select({ user_id: orgMemberships.user_id })
      .from(orgMemberships)
      .where(
        and(eq(orgMemberships.org_id, workItems.org_id), eq(orgMemberships.user_id, user.userId))
      );

    const items = await db
      .select()
      .from(workItems)
      .where(
        and(
          ne(workItems.creator_id, user.userId),
          or(exists(memberRow), and(eq(workItems.general_access, 'team'), exists(teamMembership)))
        )
      )
      .orderBy(desc(workItems.updated_at));

    const urgencyOrder: Record<string, number> = {
      review: 0,
      brainstorm: 1,
      plan: 2,
      build: 3,
    };
    const statusOrder: Record<string, number> = {
      urgent: 0,
      active: 1,
      paused: 2,
      done: 3,
    };

    const sorted = items.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 2;
      const sb = statusOrder[b.status] ?? 2;
      if (sa !== sb) return sa - sb;

      const pa = urgencyOrder[a.workflow_phase ?? 'build'] ?? 3;
      const pb = urgencyOrder[b.workflow_phase ?? 'build'] ?? 3;
      if (pa !== pb) return pa - pb;

      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    // One bulk query for every item's worktrees instead of one per item
    // (T0.8) — feeds the sidebar's Team sub-rows on the shared-with-me list.
    const ids = sorted.map((item) => item.id);
    const [worktreesByWorkItem, sessionsByWorkItem] = await Promise.all([
      fetchWorktreesForWorkItems(ids),
      // Same bulk-not-per-item rule: the session registry feeds a
      // participant's thread tabs, so the shared-with-me list carries it.
      fetchSessionsForWorkItems(ids),
    ]);
    const owners = await readWorkItemOwners(ids);
    const rows = sorted.map((item) => ({
      ...item,
      ...ownerOf(owners, item.id),
      access_scope: 'work_item' as const,
      worktrees: worktreesByWorkItem.get(item.id) ?? [],
      sessions: sessionsByWorkItem.get(item.id) ?? [],
    }));
    // Items reached only through artifacts shared alone: a header each, for
    // clients that ask (older ones would read them as whole work items).
    if (req.query.include !== 'artifacts') {
      res.json(rows);
      return;
    }
    const shared = await listArtifactsSharedAlone(user.userId, { sharedWithUser: true });
    res.json([...rows, ...(await readArtifactsOnlyHeaders(shared))]);
  });
}
