import {
  PlanRequestPutBodySchema,
  PlanRequestStatusSchema,
  type PlanRequestUpdatedServerEvent,
} from '@chord/protocol';
import { and, desc, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import { agentPlanRequests } from '../db/schema.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

// Server-side liveness bound on a request the owner's device never retracts
// (design §1): created_at + 24h, enforced by the expiry sweep in
// routes/commands-device.ts. plan_response commands inherit it.
const PLAN_REQUEST_EXPIRY_MS = 24 * 60 * 60 * 1000;

interface WorkItemParams {
  work_item_id: string;
}

interface RequestParams extends WorkItemParams {
  request_id: string;
}

// The owner's sync-queue spread-merges a resolve into a still-pending create,
// so a PUT is either a full create (plan fields present, any status) or a
// bare resolve for a row that already exists (plan fields absent).
const PutPlanRequestSchema = PlanRequestPutBodySchema;

const ListPlanRequestsQuerySchema = z.object({
  status: PlanRequestStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function broadcastPlanRequestUpdated(
  connectionManager: ConnectionManager,
  row: typeof agentPlanRequests.$inferSelect
): void {
  const event: PlanRequestUpdatedServerEvent = {
    type: 'plan_request_updated',
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
 * The outbound half of remote plan approvals (design §4): the owner's device
 * publishes the agent's plan requests here via the sync-queue (PUT upsert,
 * creator-only — the device is the sole authority for these rows) and
 * retracts them the same way when they resolve locally. Anyone with access
 * reads them for the participant card; Approve/Reject answers travel the OTHER
 * channel, as plan_response commands (routes/commands.ts).
 */
export function createPlanRequestsRouter(connectionManager: ConnectionManager): Router {
  const planRequestsRouter = Router({ mergeParams: true });
  planRequestsRouter.use(requireWorkItemRole('view'));

  // Participant card feed. Descending created_at: the pending card list and
  // any recent-history rendering both want newest-first.
  planRequestsRouter.get('/', async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = ListPlanRequestsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const scope = parsed.data.status
      ? and(
          eq(agentPlanRequests.work_item_id, work_item_id),
          eq(agentPlanRequests.status, parsed.data.status)
        )
      : eq(agentPlanRequests.work_item_id, work_item_id);

    const rows = await db
      .select()
      .from(agentPlanRequests)
      .where(scope)
      .orderBy(desc(agentPlanRequests.created_at))
      .limit(parsed.data.limit);

    res.json(rows);
  });

  // Idempotent upsert — the sync-queue retries on failure and may replay a
  // delivered PUT whose response was lost, so every path here must be safe
  // to repeat. Transitions are one-way: pending → resolved/expired. A
  // terminal row never resurrects (a late duplicate create echoes it) and
  // never flips to the other terminal state (the sweep and the device can
  // race; whoever committed first told the room already).
  planRequestsRouter.put(
    '/:request_id',
    requireWorkItemRole('author'),
    async (req: Request<RequestParams>, res) => {
      const { work_item_id, request_id } = req.params;
      const parsed = PutPlanRequestSchema.safeParse(req.body);
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
        .from(agentPlanRequests)
        .where(
          and(
            eq(agentPlanRequests.request_id, request_id),
            eq(agentPlanRequests.work_item_id, work_item_id)
          )
        )
        .limit(1);

      if (!existing) {
        // A bare resolve for a row that never existed: the create either
        // never happened or was replayed out of order — refuse rather than
        // fabricate a card with no plan context. 409 (not 404): a 404 from
        // this route means "work item missing" to the sync-queue's
        // child-entity requeue policy, and this is not that.
        if (!body.title || body.overview === undefined || !body.steps) {
          res.status(409).json({ error: 'Plan request not found and body is not a create' });
          return;
        }

        const now = new Date();
        const [created] = await db
          .insert(agentPlanRequests)
          .values({
            request_id,
            work_item_id,
            session_id: body.session_id ?? null,
            title: body.title,
            overview: body.overview,
            steps: body.steps,
            status: body.status,
            resolution: body.resolution ?? null,
            resolved_by: body.resolved_by ?? null,
            created_at: now,
            expires_at: new Date(now.getTime() + PLAN_REQUEST_EXPIRY_MS),
          })
          // Two owner windows can race the same request id — the loser's
          // insert lands on the winner's row and falls through to the echo.
          .onConflictDoNothing()
          .returning();

        if (created) {
          broadcastPlanRequestUpdated(connectionManager, created);
          res.status(201).json(created);
          return;
        }
      }

      const [current] = await db
        .select()
        .from(agentPlanRequests)
        .where(eq(agentPlanRequests.request_id, request_id))
        .limit(1);
      if (!current) {
        throw new Error('plan request vanished mid-upsert');
      }

      // Terminal rows are settled; repeats and late creates echo them.
      if (current.status !== 'pending' || body.status === current.status) {
        res.json(current);
        return;
      }

      const [updated] = await db
        .update(agentPlanRequests)
        .set({
          status: body.status,
          resolution: body.resolution ?? null,
          resolved_by: body.resolved_by ?? null,
        })
        // Guarded on pending so a concurrent sweep/retraction race settles
        // on whichever transition committed first.
        .where(
          and(eq(agentPlanRequests.request_id, request_id), eq(agentPlanRequests.status, 'pending'))
        )
        .returning();

      if (!updated) {
        const [settled] = await db
          .select()
          .from(agentPlanRequests)
          .where(eq(agentPlanRequests.request_id, request_id))
          .limit(1);
        res.json(settled);
        return;
      }

      broadcastPlanRequestUpdated(connectionManager, updated);
      res.json(updated);
    }
  );

  return planRequestsRouter;
}
