import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { teamInvites } from '../db/schema-sharing.js';
import { orgMemberships } from '../db/schema.js';

/**
 * A seat is a current member OR a live (pending, unexpired) invite — an
 * invite reserves the seat it will occupy on acceptance, otherwise an org at
 * its limit could queue unlimited invites that all resolve to members later.
 * Shared by the invite seat gate (organizations route) and the billing
 * surface so the two can never disagree about how full a team is.
 */
export async function countSeatsUsed(orgId: string): Promise<number> {
  const now = new Date();

  const members = await db
    .select({ user_id: orgMemberships.user_id })
    .from(orgMemberships)
    .where(eq(orgMemberships.org_id, orgId));

  const pendingInvites = await db
    .select({ expires_at: teamInvites.expires_at })
    .from(teamInvites)
    .where(and(eq(teamInvites.org_id, orgId), eq(teamInvites.status, 'pending')));

  const liveInvites = pendingInvites.filter((invite) => invite.expires_at > now).length;
  return members.length + liveInvites;
}
