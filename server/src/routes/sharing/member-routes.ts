import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Router } from 'express';
import { z } from 'zod';
import { invalidateWorkItemAccess } from '../../access/access-cache.js';
import { recheckLiveAccess } from '../../access/recheck-live-access.js';
import { recordAccessEvent } from '../../access/record-access-event.js';
import { db } from '../../db/client.js';
import { resourceMembers } from '../../db/schema-sharing.js';
import { orgMemberships } from '../../db/schema.js';
import { inviteToTeam } from '../../lib/team-invites.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import { announceMemberChange } from './announce-member-change.js';
import {
  findMember,
  findUserByEmail,
  loadResourceContext,
  type MemberView,
} from './resource-members.js';
import type { ResourceScope } from './resource-scope.js';

const AddMemberSchema = z.object({
  email: z.email(),
  role: z.enum(['view', 'edit']),
  // Invite this email to the team (one seat) first — only for someone
  // outside the team, and only the team owner may do it.
  add_to_team: z.boolean().default(false),
});

const UpdateMemberSchema = z.object({ role: z.enum(['view', 'edit']) });

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** POST/PATCH/DELETE members for one scope (work item or artifact). Author only. */
export function registerMemberRoutes(
  router: Router,
  scope: ResourceScope,
  connectionManager: ConnectionManager
): void {
  router.post('/members', scope.requireRole('author'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const parsed = AddMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { email, role, add_to_team } = parsed.data;
    const ref = scope.refOf(req);
    const context = await loadResourceContext(ref);

    const invitee = await findUserByEmail(email);
    if (invitee?.id === context.authorId) {
      res.status(400).json({ error: 'The author already has access' });
      return;
    }

    const inTeam = invitee ? await isTeamMember(invitee.id, context.orgId) : false;
    if (!inTeam) {
      if (!add_to_team) {
        res.status(409).json({
          error: `${email} is not in your team. Add them to the team to share with them.`,
          code: 'NOT_A_TEAM_MEMBER',
          email,
        });
        return;
      }
      if (!(await isTeamOwner(user.userId, context.orgId))) {
        res.status(403).json({
          error: 'Only the team owner can add people to the team',
          code: 'TEAM_OWNER_ONLY',
        });
        return;
      }
      const invite = await inviteToTeam(
        {
          orgId: context.orgId,
          inviterId: user.userId,
          email,
          role: 'member',
        },
        connectionManager
      );
      if (invite.status !== 200 && invite.status !== 201) {
        res.status(invite.status).json(invite.body);
        return;
      }
    }

    const id = randomUUID();
    try {
      await db.insert(resourceMembers).values({
        id,
        work_item_id: ref.workItemId,
        artifact_id: ref.artifactId,
        user_id: inTeam ? invitee!.id : null,
        invited_email: inTeam ? null : email,
        role,
        granted_by: user.userId,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      res.status(409).json({ error: `${email} already has access`, code: 'ALREADY_A_MEMBER' });
      return;
    }
    invalidateWorkItemAccess(ref.workItemId);
    await recordAccessEvent({
      workItemId: ref.workItemId,
      artifactId: ref.artifactId,
      actorId: user.userId,
      action: 'member_added',
      subjectUserId: inTeam ? invitee!.id : null,
      subjectEmail: email,
      role,
    });

    const member = await findMember(ref, id);
    if (!member) throw new Error(`[sharing] member ${id} vanished after insert`);
    if (member.user_id) {
      await announceMemberChange(connectionManager, {
        ref,
        userId: member.user_id,
        email: member.email,
        role,
        previousRole: null,
        sharerId: user.userId,
      });
    }
    res.status(201).json(member);
  });

  router.patch('/members/:member_id', scope.requireRole('author'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const parsed = UpdateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const ref = scope.refOf(req);
    const current = await findMember(ref, req.params.member_id as string);
    if (!current) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    await db
      .update(resourceMembers)
      .set({ role: parsed.data.role })
      .where(eq(resourceMembers.id, current.id));
    await recordAccessEvent({
      workItemId: ref.workItemId,
      artifactId: ref.artifactId,
      actorId: user.userId,
      action: 'member_role_changed',
      subjectUserId: current.user_id,
      subjectEmail: current.email,
      role: parsed.data.role,
    });
    await recheckLiveAccess(connectionManager, ref.workItemId);

    const updated: MemberView = { ...current, role: parsed.data.role };
    if (updated.user_id) {
      await announceMemberChange(connectionManager, {
        ref,
        userId: updated.user_id,
        email: updated.email,
        role: updated.role,
        previousRole: current.role,
        sharerId: user.userId,
      });
    }
    res.json(updated);
  });

  router.delete('/members/:member_id', scope.requireRole('author'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const ref = scope.refOf(req);
    const current = await findMember(ref, req.params.member_id as string);
    if (!current) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    await db.delete(resourceMembers).where(eq(resourceMembers.id, current.id));
    await recordAccessEvent({
      workItemId: ref.workItemId,
      artifactId: ref.artifactId,
      actorId: user.userId,
      action: 'member_removed',
      subjectUserId: current.user_id,
      subjectEmail: current.email,
      role: current.role,
    });
    await recheckLiveAccess(connectionManager, ref.workItemId);

    if (current.user_id) {
      await announceMemberChange(connectionManager, {
        ref,
        userId: current.user_id,
        email: current.email,
        role: null,
        previousRole: current.role,
        sharerId: user.userId,
      });
    }
    res.status(204).end();
  });
}

async function isTeamMember(userId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.user_id, userId), eq(orgMemberships.org_id, orgId)))
    .limit(1);
  return !!row;
}

async function isTeamOwner(userId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.user_id, userId), eq(orgMemberships.org_id, orgId)))
    .limit(1);
  return row?.role === 'owner';
}
