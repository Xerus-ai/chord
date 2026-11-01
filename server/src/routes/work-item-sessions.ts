import {
  CloudSessionsPutBodySchema,
  type CloudSession,
  type WorkItemSessionsUpdatedServerEvent,
} from '@chord/protocol';
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import { workItemSessions } from '../db/schema.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

interface WorkItemParams {
  work_item_id: string;
}

type SessionRow = typeof workItemSessions.$inferSelect;

function toWireSession(row: SessionRow): CloudSession {
  return {
    id: row.id,
    work_item_id: row.work_item_id,
    agent_provider_id: row.agent_provider_id,
    title: row.title,
    status: row.status as CloudSession['status'],
    worktree_id: row.worktree_id,
    last_active_at: row.last_active_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    model_label: row.model_label,
    permission_mode_label: row.permission_mode_label,
  };
}

export function broadcastSessionsUpdated(
  connectionManager: ConnectionManager,
  workItemId: string,
  sessions: CloudSession[]
): void {
  const event: WorkItemSessionsUpdatedServerEvent = {
    type: 'work_item_sessions_updated',
    payload: { work_item_id: workItemId, sessions },
  };
  connectionManager.broadcastToRoom(workItemRoomId(workItemId), event);
}

/**
 * The cloud session registry (devstation-uka). The owner's device publishes
 * its full CHAT-session list here whenever a session is created, renamed,
 * changes status or worktree, or finishes a turn — via the sync-queue's
 * 'sessions' entity (one queue row per work item, latest-wins). It is what
 * lets a participant render one tab per thread and address a message to one
 * of them; before it, `agent_sessions` never left the owner's SQLite.
 *
 * Write access, not creator-only: this mirrors worktrees rather than
 * git-state, for the same reason — the payload carries no source content, and
 * under the multi-session model any write-tier participant's device could be
 * the one running an agent. Readers use the plain access gate via the GET
 * included on work item list/detail responses (routes/work-items.ts).
 */
export function createWorkItemSessionsRouter(connectionManager: ConnectionManager): Router {
  const router = Router({ mergeParams: true });
  router.use(requireWorkItemRole('view'));

  // Bulk replace: the listed rows are the caller's full current chat-session
  // set for this item. Upsert what's listed, delete what's not — in one
  // db.batch() (a single non-interactive transaction on neon-http; see
  // work-item-worktrees.ts and git-state.ts for the identical pattern and why
  // neon-http cannot do a real multi-statement transaction any other way).
  router.put('/', requireWorkItemRole('edit'), async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = CloudSessionsPutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const entries = parsed.data.sessions;
    const now = new Date();
    const listedIds = entries.map((entry) => entry.id);

    // Session ids are client-generated. An id already owned by another work
    // item must never be rewritten through this item's write access.
    if (listedIds.length > 0) {
      const foreign = await db
        .select({ id: workItemSessions.id })
        .from(workItemSessions)
        .where(
          and(
            inArray(workItemSessions.id, listedIds),
            ne(workItemSessions.work_item_id, work_item_id)
          )
        );
      if (foreign.length > 0) {
        res.status(409).json({ error: 'session id belongs to another work item' });
        return;
      }
    }

    const upsertStmt =
      entries.length > 0
        ? db
            .insert(workItemSessions)
            .values(
              entries.map((entry) => ({
                id: entry.id,
                work_item_id,
                agent_provider_id: entry.agent_provider_id,
                title: entry.title,
                status: entry.status,
                worktree_id: entry.worktree_id,
                last_active_at: new Date(entry.last_active_at),
                updated_at: now,
                model_label: entry.model_label ?? null,
                permission_mode_label: entry.permission_mode_label ?? null,
              }))
            )
            .onConflictDoUpdate({
              target: workItemSessions.id,
              // Defense in depth for the check above (a concurrent writer).
              setWhere: eq(workItemSessions.work_item_id, work_item_id),
              set: {
                agent_provider_id: sql`excluded.agent_provider_id`,
                title: sql`excluded.title`,
                status: sql`excluded.status`,
                worktree_id: sql`excluded.worktree_id`,
                last_active_at: sql`excluded.last_active_at`,
                updated_at: sql`excluded.updated_at`,
                model_label: sql`excluded.model_label`,
                permission_mode_label: sql`excluded.permission_mode_label`,
              },
            })
        : null;

    // Rows for this work item that are not listed are gone locally — delete
    // them rather than leaving cloud-only ghosts a teammate would keep seeing
    // as tabs for threads that no longer exist.
    const deleteStmt =
      listedIds.length > 0
        ? db
            .delete(workItemSessions)
            .where(
              and(
                eq(workItemSessions.work_item_id, work_item_id),
                notInArray(workItemSessions.id, listedIds)
              )
            )
        : db.delete(workItemSessions).where(eq(workItemSessions.work_item_id, work_item_id));

    if (upsertStmt) {
      await db.batch([upsertStmt, deleteStmt]);
    } else {
      await deleteStmt;
    }

    const rows = await db
      .select()
      .from(workItemSessions)
      .where(eq(workItemSessions.work_item_id, work_item_id));
    const wireRows = rows.map(toWireSession);

    broadcastSessionsUpdated(connectionManager, work_item_id, wireRows);

    res.json({ sessions: wireRows });
  });

  return router;
}

export async function fetchSessionsForWorkItems(
  workItemIds: string[]
): Promise<Map<string, CloudSession[]>> {
  if (workItemIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(workItemSessions)
    .where(inArray(workItemSessions.work_item_id, workItemIds));

  const byWorkItem = new Map<string, CloudSession[]>();
  for (const row of rows) {
    const wire = toWireSession(row);
    byWorkItem.set(row.work_item_id, [...(byWorkItem.get(row.work_item_id) ?? []), wire]);
  }
  return byWorkItem;
}
