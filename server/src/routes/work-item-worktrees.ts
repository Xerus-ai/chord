import {
  CloudWorktreesPutBodySchema,
  type CloudWorktree,
  type WorkItemWorktreesUpdatedServerEvent,
} from '@chord/protocol';
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import { workItemWorktrees } from '../db/schema.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

interface WorkItemParams {
  work_item_id: string;
}

type WorktreeRow = typeof workItemWorktrees.$inferSelect;

function toWireWorktree(row: WorktreeRow): CloudWorktree {
  return {
    id: row.id,
    work_item_id: row.work_item_id,
    branch_name: row.branch_name,
    base_branch: row.base_branch,
    title: row.title,
    is_primary: row.is_primary,
    status_bucket: row.status_bucket as CloudWorktree['status_bucket'],
    additions: row.additions,
    deletions: row.deletions,
    diff_known: row.diff_known,
    archived_at: row.archived_at ? row.archived_at.toISOString() : null,
    updated_at: row.updated_at.toISOString(),
  };
}

export function broadcastWorktreesUpdated(
  connectionManager: ConnectionManager,
  workItemId: string,
  worktrees: CloudWorktree[]
): void {
  const event: WorkItemWorktreesUpdatedServerEvent = {
    type: 'work_item_worktrees_updated',
    payload: { work_item_id: workItemId, worktrees },
  };
  connectionManager.broadcastToRoom(workItemRoomId(workItemId), event);
}

/**
 * Outbound half of T0.8 (cloud sync of worktree metadata, D2): the owner's
 * device publishes its full worktree list here on worktree create/archive/
 * title/promote and on bucket-changing turn events, via the sync-queue's
 * 'worktrees' entity (one queue row per work item, latest-wins). Anyone with
 * write access may push — unlike git-state and plan-requests, which are
 * creator-only, worktree metadata carries no source content and any
 * write-tier participant's device could equally be the one running the
 * agent (T0.9's multi-session model). Readers use the plain access gate via
 * the GET included on work item list/detail responses (routes/work-items.ts).
 */
export function createWorkItemWorktreesRouter(connectionManager: ConnectionManager): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkItemRole('view'));

  // Bulk replace: the listed rows are the caller's full current worktree set
  // for this item. Upsert what's listed, delete what's not — all in one
  // db.batch() (a single non-interactive transaction on neon-http; see
  // git-state.ts's identical pattern and its comment on why neon-http can't
  // do a real multi-statement transaction any other way).
  router.put('/', requireWorkItemRole('edit'), async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = CloudWorktreesPutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const entries = parsed.data.worktrees;
    const now = new Date();
    const listedIds = entries.map((entry) => entry.id);

    // Worktree ids are client-generated. An id already owned by another work
    // item must never be rewritten through this item's write access.
    if (listedIds.length > 0) {
      const foreign = await db
        .select({ id: workItemWorktrees.id })
        .from(workItemWorktrees)
        .where(
          and(
            inArray(workItemWorktrees.id, listedIds),
            ne(workItemWorktrees.work_item_id, work_item_id)
          )
        );
      if (foreign.length > 0) {
        res.status(409).json({ error: 'worktree id belongs to another work item' });
        return;
      }
    }

    const upsertStmt =
      entries.length > 0
        ? db
            .insert(workItemWorktrees)
            .values(
              entries.map((entry) => ({
                id: entry.id,
                work_item_id,
                branch_name: entry.branch_name,
                base_branch: entry.base_branch,
                title: entry.title,
                is_primary: entry.is_primary,
                status_bucket: entry.status_bucket,
                additions: entry.additions,
                deletions: entry.deletions,
                diff_known: entry.diff_known,
                archived_at: entry.archived_at ? new Date(entry.archived_at) : null,
                updated_at: now,
              }))
            )
            .onConflictDoUpdate({
              target: workItemWorktrees.id,
              // Defense in depth for the check above (a concurrent writer).
              setWhere: eq(workItemWorktrees.work_item_id, work_item_id),
              set: {
                branch_name: sql`excluded.branch_name`,
                base_branch: sql`excluded.base_branch`,
                title: sql`excluded.title`,
                is_primary: sql`excluded.is_primary`,
                status_bucket: sql`excluded.status_bucket`,
                additions: sql`excluded.additions`,
                deletions: sql`excluded.deletions`,
                diff_known: sql`excluded.diff_known`,
                archived_at: sql`excluded.archived_at`,
                updated_at: sql`excluded.updated_at`,
              },
            })
        : null;

    // Rows for this work item that are not in the listed set are gone
    // locally (e.g. the client trims very old archived rows) — delete them
    // rather than leaving cloud-only ghosts a teammate would keep seeing.
    const deleteStmt =
      listedIds.length > 0
        ? db
            .delete(workItemWorktrees)
            .where(
              and(
                eq(workItemWorktrees.work_item_id, work_item_id),
                notInArray(workItemWorktrees.id, listedIds)
              )
            )
        : db.delete(workItemWorktrees).where(eq(workItemWorktrees.work_item_id, work_item_id));

    if (upsertStmt) {
      await db.batch([upsertStmt, deleteStmt]);
    } else {
      await deleteStmt;
    }

    const rows = await db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.work_item_id, work_item_id));
    const wireRows = rows.map(toWireWorktree);

    broadcastWorktreesUpdated(connectionManager, work_item_id, wireRows);

    res.json({ worktrees: wireRows });
  });

  return router;
}

export async function fetchWorktreesForWorkItems(
  workItemIds: string[]
): Promise<Map<string, CloudWorktree[]>> {
  if (workItemIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(workItemWorktrees)
    .where(inArray(workItemWorktrees.work_item_id, workItemIds));

  const byWorkItem = new Map<string, CloudWorktree[]>();
  for (const row of rows) {
    const wire = toWireWorktree(row);
    byWorkItem.set(row.work_item_id, [...(byWorkItem.get(row.work_item_id) ?? []), wire]);
  }
  return byWorkItem;
}
