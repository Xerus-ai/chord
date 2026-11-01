import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { activatePendingMembers } from '../access/activate-pending-members.js';
import { db } from '../db/client.js';
import { notifications, teamInvites } from '../db/schema-sharing.js';
import { orgMemberships, users } from '../db/schema.js';
import { getPendingInvitesForEmail } from '../lib/accept-team-invites.js';
import {
  createWorkosMembership,
  deactivateWorkosMembership,
  revokeWorkosInvitation,
} from '../lib/org-membership.js';
import { resolveVerifiedEmail } from '../lib/verified-email.js';
import { requireOrgMembership, type OrgScopedRequest } from '../middleware/access-control.js';
import { type AuthenticatedRequest } from '../middleware/auth.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { announceActivatedMembers } from './sharing/announce-member-change.js';

// Marks the invitee's actionable `team_invite` notifications read so a lingering
// inline Accept/Decline button can't fire twice. The notifications schema
// carries no invite/org linkage, so this resolves by (user, type) — the
// authoritative surface for what's still open is `GET /invites/mine`.
async function resolveInviteNotifications(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.type, 'team_invite')));
}

// The org lifecycle routes: invite acceptance/decline (invitee-driven, NOT
// membership-gated) and owner-driven revoke/remove plus member self-leave.
// Mounted on the same `/organizations` base as the CRUD router. Split out of
// organizations.ts to keep each file focused and under the size limit.
//
// `resolveEmail` is injectable so tests can supply a known verified email
// without hitting WorkOS (the only external dependency in the invitee auth
// path); production uses the real WorkOS-backed resolver by default.
export function createOrgLifecycleRouter(
  connectionManager: ConnectionManager,
  resolveEmail: (userId: string) => Promise<string | null> = resolveVerifiedEmail
): Router {
  const router = Router();

  // Pending, non-expired invites addressed to the caller's verified email.
  // Not org-scoped: an invitee holds no membership in the inviting org yet.
  router.get('/invites/mine', async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const email = await resolveEmail(user.userId);
    if (!email) {
      res.json([]);
      return;
    }
    res.json(await getPendingInvitesForEmail(email));
  });

  router.post('/invites/:invite_id/accept', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const invite_id = req.params.invite_id as string;

    const email = await resolveEmail(user.userId);
    if (!email) {
      res.status(503).json({ error: 'A verified email is required to accept invites' });
      return;
    }

    const [invite] = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.id, invite_id))
      .limit(1);
    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }
    // Load-bearing security check: authorize by the WorkOS-verified email, not
    // membership (the invitee has none yet) and never a client-supplied value —
    // otherwise any caller could claim another person's invite.
    if (invite.email !== email) {
      res.status(403).json({ error: 'This invite was not addressed to you' });
      return;
    }
    if (invite.status === 'accepted') {
      res.status(200).json({ org_id: invite.org_id, status: 'accepted' });
      return;
    }
    if (invite.status !== 'pending') {
      res.status(409).json({ error: `This invite has been ${invite.status}` });
      return;
    }
    if (invite.expires_at < new Date()) {
      res.status(410).json({ error: 'This invite has expired' });
      return;
    }

    // Local Neon write is authoritative and atomic. neon-http has no
    // interactive transactions, so db.batch commits these together: membership
    // (idempotent), the status flip gated on `pending` (the concurrency guard),
    // and the notification resolve.
    await db.batch([
      db
        .insert(orgMemberships)
        .values({ user_id: user.userId, org_id: invite.org_id, role: 'member' })
        .onConflictDoNothing(),
      db
        .update(teamInvites)
        .set({ status: 'accepted', accepted_at: new Date() })
        .where(and(eq(teamInvites.id, invite_id), eq(teamInvites.status, 'pending'))),
      db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.user_id, user.userId), eq(notifications.type, 'team_invite'))),
    ]);

    // Mirror into WorkOS after the authoritative write — loud on failure but
    // never rolled back (see org-membership.ts). Accepting locally makes the
    // WorkOS pending invitation redundant, so it's revoked.
    await createWorkosMembership(invite.org_id, user.userId);
    await revokeWorkosInvitation(email, invite.org_id);

    // Work items and artifacts shared with this email before they were in the
    // team (sharing's "add to team") open now.
    const activated = await activatePendingMembers(user.userId, email);
    await announceActivatedMembers(connectionManager, user.userId, email, activated);

    res.status(200).json({ org_id: invite.org_id, status: 'accepted' });
  });

  router.post('/invites/:invite_id/decline', async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const invite_id = req.params.invite_id as string;

    const email = await resolveEmail(user.userId);
    if (!email) {
      res.status(503).json({ error: 'A verified email is required to decline invites' });
      return;
    }

    const [invite] = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.id, invite_id))
      .limit(1);
    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }
    if (invite.email !== email) {
      res.status(403).json({ error: 'This invite was not addressed to you' });
      return;
    }
    if (invite.status === 'declined') {
      res.status(200).json({ status: 'declined' });
      return;
    }
    if (invite.status !== 'pending') {
      res.status(409).json({ error: `This invite has been ${invite.status}` });
      return;
    }

    await db.batch([
      db
        .update(teamInvites)
        .set({ status: 'declined' })
        .where(and(eq(teamInvites.id, invite_id), eq(teamInvites.status, 'pending'))),
      db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.user_id, user.userId), eq(notifications.type, 'team_invite'))),
    ]);

    await revokeWorkosInvitation(email, invite.org_id);

    res.status(200).json({ status: 'declined' });
  });

  router.delete('/:org_id/invites/:invite_id', requireOrgMembership, async (req, res) => {
    const { orgMembership } = req as unknown as OrgScopedRequest;
    const org_id = req.params.org_id as string;
    const invite_id = req.params.invite_id as string;

    if (orgMembership.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can revoke invites' });
      return;
    }

    const [invite] = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.id, invite_id))
      .limit(1);
    if (!invite || invite.org_id !== org_id) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }
    if (invite.status !== 'pending') {
      res.status(409).json({ error: `This invite has been ${invite.status}` });
      return;
    }

    // Terminal status frees the seat immediately (countSeatsUsed counts only
    // pending invites).
    await db
      .update(teamInvites)
      .set({ status: 'revoked' })
      .where(and(eq(teamInvites.id, invite_id), eq(teamInvites.status, 'pending')));

    const [invitee] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, invite.email))
      .limit(1);
    if (invitee) await resolveInviteNotifications(invitee.id);

    await revokeWorkosInvitation(invite.email, org_id);

    res.status(200).json({ status: 'revoked' });
  });

  router.delete('/:org_id/members/:user_id', requireOrgMembership, async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const { orgMembership } = req as unknown as OrgScopedRequest;
    const org_id = req.params.org_id as string;
    const target_user_id = req.params.user_id as string;

    if (orgMembership.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can remove members' });
      return;
    }
    if (target_user_id === user.userId) {
      res.status(409).json({ error: 'Use leave to remove yourself from the team' });
      return;
    }

    const [membership] = await db
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.org_id, org_id), eq(orgMemberships.user_id, target_user_id)))
      .limit(1);
    if (!membership) {
      res.status(404).json({ error: 'That user is not a member of this team' });
      return;
    }
    if (membership.role === 'owner') {
      res.status(409).json({ error: 'The owner cannot be removed' });
      return;
    }

    await db
      .delete(orgMemberships)
      .where(and(eq(orgMemberships.org_id, org_id), eq(orgMemberships.user_id, target_user_id)));

    await deactivateWorkosMembership(org_id, target_user_id);

    res.status(200).json({ status: 'removed' });
  });

  router.post('/:org_id/leave', requireOrgMembership, async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const { orgMembership } = req as unknown as OrgScopedRequest;
    const org_id = req.params.org_id as string;

    if (orgMembership.role === 'owner') {
      res.status(409).json({ error: 'The owner cannot leave; transfer ownership first' });
      return;
    }

    await db
      .delete(orgMemberships)
      .where(and(eq(orgMemberships.org_id, org_id), eq(orgMemberships.user_id, user.userId)));

    await deactivateWorkosMembership(org_id, user.userId);

    res.status(200).json({ status: 'left' });
  });

  return router;
}
