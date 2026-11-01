import { randomUUID } from 'node:crypto';
import { WorkOS } from '@workos-inc/node';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { teamInvites } from '../db/schema-sharing.js';
import { organizations, orgMemberships, users } from '../db/schema.js';
import { notifyTeamInvite, type TeamInviteMade } from '../notifications/notify-team-invite.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { countSeatsUsed } from './org-seats.js';

const workos = process.env.WORKOS_API_KEY ? new WorkOS(process.env.WORKOS_API_KEY) : null;

export interface TeamInviteRequest {
  orgId: string;
  inviterId: string;
  email: string;
  role: 'admin' | 'member';
}

export interface TeamInviteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Invites an email to the team: one seat, enforced. Used by Workspace › Team
 * (POST /organizations/:org_id/invites) and by sharing, when a work item or
 * artifact is shared with someone outside the team. The caller has already
 * checked that the inviter is the team owner.
 *
 * Order: already a member → 409; a live pending invite is reused (no second
 * email — the trusted-sender email-bombing guard); seat limit → 403
 * SEAT_LIMIT_REACHED; then WorkOS sends the email BEFORE the local row, so a
 * failure leaves no orphaned invite.
 */
export async function inviteToTeam(
  request: TeamInviteRequest,
  connectionManager: ConnectionManager
): Promise<TeamInviteResult> {
  const { orgId, email } = request;
  const now = new Date();

  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (invitee) {
    const [membership] = await db
      .select({ user_id: orgMemberships.user_id })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.user_id, invitee.id), eq(orgMemberships.org_id, orgId)))
      .limit(1);
    if (membership) {
      return { status: 409, body: { error: `${email} is already a member of this team` } };
    }
  }

  const [existingInvite] = await db
    .select({ id: teamInvites.id, role: teamInvites.role, expires_at: teamInvites.expires_at })
    .from(teamInvites)
    .where(
      and(
        eq(teamInvites.org_id, orgId),
        eq(teamInvites.email, email),
        eq(teamInvites.status, 'pending')
      )
    )
    .limit(1);

  if (existingInvite && existingInvite.expires_at > now) {
    return {
      status: 200,
      body: {
        id: existingInvite.id,
        org_id: orgId,
        email,
        role: existingInvite.role,
        status: 'pending',
        expires_at: existingInvite.expires_at.toISOString(),
        deduplicated: true,
      },
    };
  }

  const [org] = await db
    .select({ plan: organizations.plan, seat_limit: organizations.seat_limit })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { status: 404, body: { error: 'Organization not found' } };

  const seatsUsed = await countSeatsUsed(orgId);
  if (seatsUsed >= org.seat_limit) {
    return {
      status: 403,
      body: {
        error: `Your ${org.plan} plan includes ${org.seat_limit} seats and all of them are taken. Upgrade to invite more teammates.`,
        code: 'SEAT_LIMIT_REACHED',
        plan: org.plan,
        seat_limit: org.seat_limit,
        seats_used: seatsUsed,
      },
    };
  }

  if (!workos) {
    return { status: 503, body: { error: 'WORKOS_API_KEY is not configured on this server' } };
  }

  try {
    await workos.userManagement.sendInvitation({ email, organizationId: orgId });
  } catch (err) {
    const status =
      typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : null;
    const message = err instanceof Error ? err.message : 'sendInvitation failed';
    console.error(
      `[team-invites] sendInvitation failed org=${orgId} email=${email} status=${status}:`,
      message
    );
    if (status !== null && status >= 400 && status < 500) {
      return {
        status: 409,
        body: { error: `Could not invite ${email}: ${message}`, code: 'WORKOS_INVITE_REJECTED' },
      };
    }
    return {
      status: 502,
      body: {
        error: 'The invitation service is unavailable. Please try again.',
        code: 'WORKOS_UNAVAILABLE',
      },
    };
  }

  const inviteId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(teamInvites).values({
    id: inviteId,
    org_id: orgId,
    inviter_id: request.inviterId,
    email,
    role: request.role,
    status: 'pending',
    expires_at: expiresAt,
  });

  if (invitee) {
    await notifyInvitee(connectionManager, {
      inviteId,
      orgId,
      inviterId: request.inviterId,
      inviteeId: invitee.id,
    });
  }

  return {
    status: 201,
    body: {
      id: inviteId,
      org_id: orgId,
      email,
      role: request.role,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    },
  };
}

// The invite already succeeded; a notification failure must not roll it back,
// but it must be LOUD in the logs, never swallowed.
async function notifyInvitee(
  connectionManager: ConnectionManager,
  made: TeamInviteMade
): Promise<void> {
  try {
    await notifyTeamInvite(connectionManager, made);
  } catch (err) {
    console.error(
      '[team-invites] invite notification failed:',
      err instanceof Error ? err.message : err
    );
  }
}
