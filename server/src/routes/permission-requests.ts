import {
  PermissionRequestPutBodySchema,
  PermissionRequestStatusSchema,
  type PermissionRequestUpdatedServerEvent,
} from '@chord/protocol';
import { and, desc, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import { agentPermissionRequests } from '../db/schema.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

// Server-side liveness bound on a request the owner's device never retracts
// (design §1): created_at + 24h, enforced by the expiry sweep in
// routes/commands-device.ts. permission_response commands inherit it.
const PERMISSION_REQUEST_EXPIRY_MS = 24 * 60 * 60 * 1000;

interface WorkItemParams {
  work_item_id: string;
}

interface RequestParams extends WorkItemParams {
  request_id: string;
}

// The owner's sync-queue spread-merges a resolve into a still-pending create,
// so a PUT is either a full create (tool fields present, any status) or a
// bare resolve for a row that already exists (tool fields absent).
const PutPermissionRequestSchema = PermissionRequestPutBodySchema;

const ListPermissionRequestsQuerySchema = z.object({
  status: PermissionRequestStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function broadcastPermissionRequestUpdated(
  connectionManager: ConnectionManager,
  row: typeof agentPermissionRequests.$inferSelect
): void {
  const event: PermissionRequestUpdatedServerEvent = {
    type: 'permission_request_updated',
    payload: {
      request_id: row.request_id,
      work_item_id: row.work_item_id,
      status: row.status,
      resolved_by: row.resolved_by,
      resolution: row.resolution,
    },
  };
  connectionManager.broadcastToRoom(workItemRoomId(row.work_item_id), event);
}

/**
 * The outbound half of remote approvals (design §4): the owner's device
 * publishes the agent's permission requests here via the sync-queue (PUT
 * upsert, creator-only — the device is the sole authority for these rows)
 * and retracts them the same way when they resolve locally. Anyone with
 * access reads them for the participant card; Allow/Deny answers travel the
 * OTHER channel, as permission_response commands (routes/commands.ts).
 */
export function createPermissionRequestsRouter(connectionManager: ConnectionManager): Router {
  const permissionRequestsRouter = Router({ mergeParams: true });
  permissionRequestsRouter.use(requireWorkItemRole('view'));

  // Participant card feed. Descending created_at: the pending card list and
  // any recent-history rendering both want newest-first.
  permissionRequestsRouter.get('/', async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = ListPermissionRequestsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const scope = parsed.data.status
      ? and(
          eq(agentPermissionRequests.work_item_id, work_item_id),
          eq(agentPermissionRequests.status, parsed.data.status)
        )
      : eq(agentPermissionRequests.work_item_id, work_item_id);

    const rows = await db
      .select()
      .from(agentPermissionRequests)
      .where(scope)
      .orderBy(desc(agentPermissionRequests.created_at))
      .limit(parsed.data.limit);

    res.json(rows);
  });

  // Idempotent upsert — the sync-queue retries on failure and may replay a
  // delivered PUT whose response was lost, so every path here must be safe
  // to repeat. Transitions are one-way: pending → resolved/expired. A
  // terminal row never resurrects (a late duplicate create echoes it) and
  // never flips to the other terminal state (the sweep and the device can
  // race; whoever committed first told the room already).
  permissionRequestsRouter.put(
    '/:request_id',
    requireWorkItemRole('author'),
    async (req: Request<RequestParams>, res) => {
      const { work_item_id, request_id } = req.params;
      const parsed = PutPermissionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }
      const body = parsed.data;
      if (body.work_item_id !== work_item_id) {
        res.status(400).json({ error: 'work_item_id does not match the route' });
        return;
      }

      const [existing] = await db
        .select()
        .from(agentPermissionRequests)
        .where(
          and(
            eq(agentPermissionRequests.request_id, request_id),
            eq(agentPermissionRequests.work_item_id, work_item_id)
          )
        )
        .limit(1);

      if (!existing) {
        // A bare resolve for a row that never existed: the create either
        // never happened or was replayed out of order — refuse rather than
        // fabricate a card with no tool context. 409 (not 404): a 404 from
        // this route means "work item missing" to the sync-queue's
        // child-entity requeue policy, and this is not that.
        if (!body.tool_name || !body.input || !body.options) {
          res.status(409).json({ error: 'Permission request not found and body is not a create' });
          return;
        }

        const now = new Date();
        const [created] = await db
          .insert(agentPermissionRequests)
          .values({
            request_id,
            work_item_id,
            session_id: body.session_id ?? null,
            tool_name: body.tool_name,
            input: body.input,
            options: body.options,
            status: body.status,
            resolution: body.resolution ?? null,
            resolved_by: body.resolved_by ?? null,
            created_at: now,
            expires_at: new Date(now.getTime() + PERMISSION_REQUEST_EXPIRY_MS),
          })
          // Two owner windows can race the same request id — the loser's
          // insert lands on the winner's row and falls through to the echo.
          .onConflictDoNothing()
          .returning();

        if (created) {
          broadcastPermissionRequestUpdated(connectionManager, created);
          res.status(201).json(created);
          return;
        }
      }

      const [current] = await db
        .select()
        .from(agentPermissionRequests)
        .where(eq(agentPermissionRequests.request_id, request_id))
        .limit(1);
      if (!current) {
        throw new Error('permission request vanished mid-upsert');
      }

      // Terminal rows are settled; repeats and late creates echo them.
      if (current.status !== 'pending' || body.status === current.status) {
        res.json(current);
        return;
      }

      const [updated] = await db
        .update(agentPermissionRequests)
        .set({
          status: body.status,
          resolution: body.resolution ?? null,
          resolved_by: body.resolved_by ?? null,
        })
        // Guarded on pending so a concurrent sweep/retraction race settles
        // on whichever transition committed first.
        .where(
          and(
            eq(agentPermissionRequests.request_id, request_id),
            eq(agentPermissionRequests.status, 'pending')
          )
        )
        .returning();

      if (!updated) {
        const [settled] = await db
          .select()
          .from(agentPermissionRequests)
          .where(eq(agentPermissionRequests.request_id, request_id))
          .limit(1);
        res.json(settled);
        return;
      }

      broadcastPermissionRequestUpdated(connectionManager, updated);
      res.json(updated);
    }
  );

  return permissionRequestsRouter;
}
