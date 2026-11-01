import { randomUUID } from 'node:crypto';
import type { WorkItemDeletedServerEvent } from '@chord/protocol';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { invalidateWorkItemAccess } from '../access/access-cache.js';
import {
  artifactsOnlyOf,
  requireWorkItemRole,
  workItemAccessOf,
} from '../access/access-middleware.js';
import { db } from '../db/client.js';
import { resourceMembers } from '../db/schema-sharing.js';
import { orgMemberships, users, workItems } from '../db/schema.js';
import { DEV_MODE, type AuthenticatedRequest } from '../middleware/auth.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { createWorkItemArtifactsRouter } from './work-item-artifacts.js';
import {
  listArtifactsSharedAlone,
  ownerOf,
  readArtifactsOnlyHeaders,
  readWorkItemOwners,
} from './work-item-headers.js';
import { CreateWorkItemSchema, UpdateWorkItemSchema } from './work-item-schemas.js';
import { fetchSessionsForWorkItems } from './work-item-sessions.js';
import { fetchWorktreesForWorkItems } from './work-item-worktrees.js';
import { registerSharedWithMeRoute } from './work-items-shared-with-me.js';

export function createWorkItemsRouter(connectionManager: ConnectionManager) {
  const workItemsRouter = Router();

  workItemsRouter.get('/', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;

    const items = await db
      .select()
      .from(workItems)
      .where(eq(workItems.creator_id, user.userId))
      .orderBy(desc(workItems.updated_at));

    res.json(items);
  });

  registerSharedWithMeRoute(workItemsRouter);

  // Every item the caller authored that has at least one active member. The
  // owner-side git-state capture (main process) shares an item's diffs only
  // when someone else can see it: a member, or team access (which the client
  // reads off the item's general_access). One query, scoped to the caller's
  // own items via creator_id, so ownership IS the access check. Registered
  // before GET /:id so "member-summary" is not swallowed by the :id route.
  workItemsRouter.get('/member-summary', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;

    const rows = await db
      .selectDistinct({ work_item_id: resourceMembers.work_item_id })
      .from(resourceMembers)
      .innerJoin(workItems, eq(resourceMembers.work_item_id, workItems.id))
      .where(
        and(
          eq(workItems.creator_id, user.userId),
          isNull(resourceMembers.artifact_id),
          isNotNull(resourceMembers.user_id)
        )
      );

    res.json(rows.map((row) => ({ work_item_id: row.work_item_id, has_members: true })));
  });

  // Who each of the caller's own items is shared with — the dashboard's card
  // avatars, as one query for every card instead of one GET
  // /:work_item_id/participants per card. Scoped by creator_id like
  // /member-summary above: rosters carry emails, and ownership is the
  // access check, so an item the caller is merely shared on never appears.
  // Only active work-item members: the author has no member row, and
  // artifact-only members and pending invites are not on the item.
  // Registered before GET /:id for the same reason as /member-summary.
  workItemsRouter.get('/participant-rosters', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;

    const rows = await db
      .select({
        work_item_id: resourceMembers.work_item_id,
        user_id: users.id,
        role: resourceMembers.role,
        name: users.name,
        email: users.email,
        avatar_url: users.avatar_url,
      })
      .from(resourceMembers)
      .innerJoin(workItems, eq(resourceMembers.work_item_id, workItems.id))
      .innerJoin(users, eq(resourceMembers.user_id, users.id))
      .where(and(eq(workItems.creator_id, user.userId), isNull(resourceMembers.artifact_id)));

    res.json(rows);
  });

  workItemsRouter.get(
    '/:id',
    requireWorkItemRole('view', { allowArtifactsOnly: true }),
    async (req, res) => {
      const id = req.params.id as string;
      // Someone who reaches only artifacts shared alone reads the header, when
      // their client asks; to an older client the item stays invisible.
      if (artifactsOnlyOf(req) !== null) {
        const shared = await listArtifactsSharedAlone(
          (req as unknown as AuthenticatedRequest).user.userId,
          { workItemId: id }
        );
        const [header] = await readArtifactsOnlyHeaders(shared);
        if (req.query.include !== 'artifacts' || !header) {
          res.status(404).json({ error: 'Work item not found' });
          return;
        }
        res.json(header);
        return;
      }

      const [item] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);

      if (!item) {
        res.status(404).json({ error: 'Work item not found' });
        return;
      }

      // The caller's own role ('view' | 'edit' | 'author'), so the client can
      // disable write affordances a viewer would only ever have refused.
      // requireWorkItemRole already resolved it; reporting it costs nothing.
      const caller_role = workItemAccessOf(req).role;

      const [worktreesByWorkItem, sessionsByWorkItem, owners] = await Promise.all([
        fetchWorktreesForWorkItems([id]),
        fetchSessionsForWorkItems([id]),
        readWorkItemOwners([id]),
      ]);

      // The honest "agent host online" signal for issuer UX (command-channel
      // design §2): whether the creator's device socket is connected right
      // now. Live updates ride the org-scoped device_presence_changed event.
      res.json({
        ...item,
        ...ownerOf(owners, id),
        access_scope: 'work_item',
        creator_device_online: connectionManager.hasDeviceOnline(item.creator_id),
        caller_role,
        worktrees: worktreesByWorkItem.get(id) ?? [],
        sessions: sessionsByWorkItem.get(id) ?? [],
      });
    }
  );

  workItemsRouter.post('/', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const parsed = CreateWorkItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const { id: clientId, ...data } = parsed.data;
    const id = clientId ?? randomUUID();
    const now = new Date();

    // org_id is a client-controlled tenancy field. Nothing grants access
    // through it today without a real membership JOIN, but any future
    // authorization decision keyed on the stored value would silently
    // inherit a forged one — so require the caller to actually belong to
    // the org they are filing the item under.
    if (!DEV_MODE) {
      const [membership] = await db
        .select({ user_id: orgMemberships.user_id })
        .from(orgMemberships)
        .where(and(eq(orgMemberships.org_id, data.org_id), eq(orgMemberships.user_id, user.userId)))
        .limit(1);
      if (!membership) {
        res.status(403).json({ error: 'Not a member of the specified organization' });
        return;
      }
    }

    // Idempotent for the client's own retries: the sync queue re-sends
    // creates whenever its cloud-inventory fetch and the cloud disagree
    // (startup reconcile races, a drain interrupted after the insert but
    // before the queue row was deleted). A duplicate id from the SAME
    // creator returns the existing row instead of 500ing on the pkey —
    // which parked a permanently-failed queue row the user had to notice.
    // A duplicate id from a DIFFERENT creator stays an error: client ids
    // are attacker-suppliable, so claiming someone else's item id must
    // fail closed.
    if (clientId) {
      const [existing] = await db
        .select()
        .from(workItems)
        .where(eq(workItems.id, clientId))
        .limit(1);
      if (existing) {
        if (existing.creator_id !== user.userId) {
          res.status(409).json({ error: 'Work item id already exists' });
          return;
        }
        res.status(200).json(existing);
        return;
      }
    }

    // The creator is the author; no member row is written for them.
    const created = await db
      .insert(workItems)
      .values({
        id,
        creator_id: user.userId,
        ...data,
        created_at: now,
        updated_at: now,
      })
      .returning();

    res.status(201).json(created[0]);
  });

  workItemsRouter.patch('/:id', requireWorkItemRole('edit'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const id = req.params.id as string;
    const parsed = UpdateWorkItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    // expected_version is a precondition, not a column — never let it into
    // .set() or ride along in the broadcast's `changes`.
    const { expected_version, ...changes } = parsed.data;

    // CAS: when the caller states which version it last saw, the update
    // only takes effect if that's still the current row — otherwise two
    // concurrent PATCHes (the two-writer hole ARCH-3b closes) silently
    // clobber each other with whichever commits last. Absent
    // expected_version, this is exactly the unconditional WHERE id = ? from
    // before (old clients, or a client with no known version yet).
    const whereClause =
      expected_version !== undefined
        ? and(eq(workItems.id, id), eq(workItems.version_number, expected_version))
        : eq(workItems.id, id);

    const [updated] = await db
      .update(workItems)
      .set({
        ...changes,
        updated_at: new Date(),
        version_number: sql`${workItems.version_number} + 1`,
      })
      .where(whereClause)
      .returning();

    if (!updated) {
      // Either the row doesn't exist, or it does but expected_version was
      // stale (CAS miss) — these need different responses, so resolve which
      // one it was with a plain read.
      const [current] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
      if (!current) {
        res.status(404).json({ error: 'Work item not found' });
        return;
      }
      res.status(409).json({ error: 'Version conflict', current });
      return;
    }

    // Live-update room members (this is the path teammate edits arrive on:
    // local change -> sync queue -> this PATCH). version_number lets clients
    // drop stale/out-of-order broadcasts instead of applying them.
    connectionManager.broadcastToRoom(workItemRoomId(id), {
      type: 'work_item_updated',
      payload: {
        work_item_id: id,
        changes,
        version_number: updated.version_number,
        updated_by: user.userId,
        updated_at: updated.updated_at.toISOString(),
      },
    });

    res.json(updated);
  });

  // Who may answer agent permission requests (design §4): 'owner' (default)
  // or 'participants' (per-item opt-in). Author-only and EXCLUDED from the
  // generic PATCH above for the same reason general_access is — it's a
  // security gate any Can edit member could otherwise flip on themselves. Bumps version_number and broadcasts work_item_updated so
  // participant cards re-gate their Allow/Deny buttons live.
  const UpdateApprovalPolicySchema = z.object({
    approval_policy: z.enum(['owner', 'participants']),
  });

  workItemsRouter.patch('/:id/approval-policy', requireWorkItemRole('author'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const id = req.params.id as string;
    const parsed = UpdateApprovalPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const [updated] = await db
      .update(workItems)
      .set({
        approval_policy: parsed.data.approval_policy,
        updated_at: new Date(),
        version_number: sql`${workItems.version_number} + 1`,
      })
      .where(eq(workItems.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }

    connectionManager.broadcastToRoom(workItemRoomId(id), {
      type: 'work_item_updated',
      payload: {
        work_item_id: id,
        changes: { approval_policy: updated.approval_policy },
        version_number: updated.version_number,
        updated_by: user.userId,
        updated_at: updated.updated_at.toISOString(),
      },
    });

    res.json(updated);
  });

  // Creator-only in the SAME change that gave the schema working cascades:
  // without the gate, cascades turn the formerly-broken delete into one any
  // participant (or anyone at all, for public items) can fire.
  workItemsRouter.delete('/:id', requireWorkItemRole('author'), async (req, res) => {
    const id = req.params.id as string;

    const deleted = await db
      .delete(workItems)
      .where(eq(workItems.id, id))
      .returning({ id: workItems.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }
    invalidateWorkItemAccess(id);

    // Delete → confirm → broadcast. Rooms live in ConnectionManager memory,
    // so a post-delete broadcast still reaches members, while a broadcast
    // before a failed delete would strand every client in a terminal
    // "deleted" state the 404 fallback could never correct. Clients not in
    // the room converge via REST 404 / sidebar disappearance — no
    // notification path, by design.
    const event: WorkItemDeletedServerEvent = {
      type: 'work_item_deleted',
      payload: { work_item_id: id },
    };
    connectionManager.broadcastToRoom(workItemRoomId(id), event);

    res.status(204).end();
  });

  // A work item's artifacts (list, register, delete) live in their own module.
  workItemsRouter.use('/:work_item_id/artifacts', createWorkItemArtifactsRouter(connectionManager));

  return workItemsRouter;
}
