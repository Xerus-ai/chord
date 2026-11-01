import { CommandFetchBodySchema, type CommandUpdatedServerEvent } from '@chord/protocol';
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db, hasDb } from '../db/client.js';
import { agentPermissionRequests, agentPlanRequests, commands, workItems } from '../db/schema.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { broadcastPermissionRequestUpdated } from './permission-requests.js';
import { broadcastPlanRequestUpdated } from './plan-requests.js';

// Same setInterval pattern as the access-cache sweep (access-control.ts).
// Expiry is a liveness cleanup, not a correctness gate — the claim/fetch
// queries below already refuse past-due pending rows on their own.
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;

const DeviceIdSchema = z.string().min(1).max(128);

// work_item_ids are the device's LOCALLY-PRESENT ids — commands for items
// that exist only on another machine stay pending for that machine to claim.
const FetchCommandsSchema = CommandFetchBodySchema;

const ClaimCommandSchema = z.object({
  device_id: DeviceIdSchema,
});

const AckCommandSchema = z
  .object({
    device_id: DeviceIdSchema,
    status: z.enum(['acked', 'failed']),
    status_reason: z.string().min(1).max(500).optional(),
  })
  .refine((a) => a.status !== 'failed' || a.status_reason !== undefined, {
    error: 'status_reason is required when status is failed',
  });

function notExpired(now: Date) {
  return or(isNull(commands.expires_at), gt(commands.expires_at, now));
}

function broadcastCommandUpdated(
  connectionManager: ConnectionManager,
  row: typeof commands.$inferSelect
): void {
  const event: CommandUpdatedServerEvent = {
    type: 'command_updated',
    payload: {
      id: row.id,
      work_item_id: row.work_item_id,
      kind: row.kind,
      issuer_id: row.issuer_id,
      status: row.status,
      status_reason: row.status_reason,
    },
  };
  connectionManager.broadcastToRoom(workItemRoomId(row.work_item_id), event);
}

/**
 * The device half of the command channel — the mirror of the sync-queue's
 * REST pushes, pointed the other way: fetch → claim → (execute locally) →
 * ack. Every route re-verifies the caller is the work item's CREATOR:
 * commands only ever execute on the owner's devices, whoever issued them.
 * Multi-device races resolve via the atomic claim, no device registry.
 */
export function createDeviceCommandsRouter(connectionManager: ConnectionManager): Router {
  const deviceRouter = Router();

  // Pending commands for the device's local work items, ascending id (issue
  // order), PLUS rows this device already claimed but never acked — crash
  // recovery: a device that died between claim and execute redelivers to
  // itself, and the local dedup ledger makes redelivery safe.
  deviceRouter.post('/fetch', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const parsed = FetchCommandsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { device_id, work_item_ids } = parsed.data;
    if (work_item_ids.length === 0) {
      res.json([]);
      return;
    }

    const rows = await db
      .select({
        command: commands,
        // Snapshot of the item's creator/policy at fetch time — the inbox
        // executor re-validates permission_response issuers against the
        // CURRENT policy rather than the insert-time gate alone (design
        // §3/§6): the owner may have flipped approval_policy back to
        // 'owner' between issue and delivery.
        creator_id: workItems.creator_id,
        approval_policy: workItems.approval_policy,
      })
      .from(commands)
      .innerJoin(workItems, eq(commands.work_item_id, workItems.id))
      .where(
        and(
          inArray(commands.work_item_id, work_item_ids),
          eq(workItems.creator_id, user.userId),
          or(
            and(eq(commands.status, 'pending'), notExpired(new Date())),
            // Own claimed-but-unacked rows return regardless of expiry — the
            // device may have executed just before the sweep flips the row,
            // and its ledger dedup handles either way safely.
            and(eq(commands.status, 'claimed'), eq(commands.claimed_by_device, device_id))
          )
        )
      )
      .orderBy(asc(commands.id));

    res.json(
      rows.map((r) => ({
        ...r.command,
        work_item_creator_id: r.creator_id,
        work_item_approval_policy: r.approval_policy,
      }))
    );
  });

  // Atomic: two devices race, one wins — the UPDATE's WHERE status='pending'
  // is the entire arbitration. A repeat claim by the SAME device echoes the
  // row (retry after a lost response must not brick delivery).
  deviceRouter.post('/:id/claim', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const id = req.params.id as string;
    const parsed = ClaimCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { device_id } = parsed.data;

    const [target] = await db
      .select({ creator_id: workItems.creator_id })
      .from(commands)
      .innerJoin(workItems, eq(commands.work_item_id, workItems.id))
      .where(eq(commands.id, id))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }
    if (target.creator_id !== user.userId) {
      res.status(403).json({ error: 'Commands only execute on the owner devices' });
      return;
    }

    const now = new Date();
    const [claimed] = await db
      .update(commands)
      .set({ status: 'claimed', claimed_by_device: device_id, claimed_at: now })
      .where(and(eq(commands.id, id), eq(commands.status, 'pending'), notExpired(now)))
      .returning();

    if (!claimed) {
      const [current] = await db.select().from(commands).where(eq(commands.id, id)).limit(1);
      if (current && current.status === 'claimed' && current.claimed_by_device === device_id) {
        res.json(current);
        return;
      }
      res.status(409).json({ error: 'Command is not claimable', status: current?.status });
      return;
    }

    broadcastCommandUpdated(connectionManager, claimed);
    res.json(claimed);
  });

  // Terminal: 'acked', or 'failed' + status_reason (surfaced on the issuer's
  // chip). Only the claiming device may ack; a repeat of the same terminal
  // transition echoes the row.
  deviceRouter.post('/:id/ack', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const id = req.params.id as string;
    const parsed = AckCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { device_id, status, status_reason } = parsed.data;

    const [target] = await db
      .select({ creator_id: workItems.creator_id })
      .from(commands)
      .innerJoin(workItems, eq(commands.work_item_id, workItems.id))
      .where(eq(commands.id, id))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }
    if (target.creator_id !== user.userId) {
      res.status(403).json({ error: 'Commands only execute on the owner devices' });
      return;
    }

    const [acked] = await db
      .update(commands)
      .set({ status, status_reason: status_reason ?? null, acked_at: new Date() })
      .where(
        and(
          eq(commands.id, id),
          eq(commands.status, 'claimed'),
          eq(commands.claimed_by_device, device_id)
        )
      )
      .returning();

    if (!acked) {
      const [current] = await db.select().from(commands).where(eq(commands.id, id)).limit(1);
      if (current && current.status === status && current.claimed_by_device === device_id) {
        res.json(current);
        return;
      }
      res.status(409).json({ error: 'Command is not ackable', status: current?.status });
      return;
    }

    broadcastCommandUpdated(connectionManager, acked);
    res.json(acked);
  });

  return deviceRouter;
}

/**
 * Flips past-due pending/claimed commands and pending permission requests to
 * 'expired' and broadcasts each transition to its work-item room. Split into
 * per-prior-status updates so status_reason can say WHERE the command died —
 * that's what the issuer's failed chip renders.
 */
async function sweepExpired(connectionManager: ConnectionManager): Promise<void> {
  const now = new Date();

  const [expiredPending, expiredClaimed] = await db.batch([
    db
      .update(commands)
      .set({ status: 'expired', status_reason: 'expired before delivery' })
      .where(and(eq(commands.status, 'pending'), lte(commands.expires_at, now)))
      .returning(),
    db
      .update(commands)
      .set({ status: 'expired', status_reason: 'expired before completion' })
      .where(and(eq(commands.status, 'claimed'), lte(commands.expires_at, now)))
      .returning(),
  ]);
  for (const row of [...expiredPending, ...expiredClaimed]) {
    broadcastCommandUpdated(connectionManager, row);
  }

  const expiredRequests = await db
    .update(agentPermissionRequests)
    .set({ status: 'expired', resolution: 'expired' })
    .where(
      and(
        eq(agentPermissionRequests.status, 'pending'),
        lte(agentPermissionRequests.expires_at, now)
      )
    )
    .returning();
  for (const row of expiredRequests) {
    broadcastPermissionRequestUpdated(connectionManager, row);
  }

  // Plan requests share the same never-retracted-by-owner failure mode: a
  // past-due pending card must flip to 'expired' and broadcast so every
  // participant's Approve/Reject card clears itself.
  const expiredPlans = await db
    .update(agentPlanRequests)
    .set({ status: 'expired', resolution: 'expired' })
    .where(and(eq(agentPlanRequests.status, 'pending'), lte(agentPlanRequests.expires_at, now)))
    .returning();
  for (const row of expiredPlans) {
    broadcastPlanRequestUpdated(connectionManager, row);
  }
}

export function startCommandExpirySweep(connectionManager: ConnectionManager): void {
  if (!hasDb) return;
  setInterval(() => {
    sweepExpired(connectionManager).catch((err: Error) => {
      console.error('[commands] expiry sweep failed:', err.message);
    });
  }, EXPIRY_SWEEP_INTERVAL_MS).unref();
}
