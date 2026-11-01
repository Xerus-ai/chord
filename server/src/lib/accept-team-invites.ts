import { and, asc, eq, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { teamInvites } from '../db/schema-sharing.js';
import { organizations } from '../db/schema.js';

export interface PendingInvite {
  id: string;
  org_id: string;
  org_name: string;
  role: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * Reads the pending, non-expired team invites addressed to a verified email,
 * joined to each org's name so the "Invitations to you" surface can render
 * without a second round-trip.
 *
 * READ-ONLY by design. Sign-in used to auto-accept these invites here (writing
 * the org membership before org resolution ran), but silently joining an
 * invitee to an org on sign-in is not consent — acceptance is now an explicit
 * user action through the invite routes. This function only surfaces what is
 * waiting; it never mutates membership.
 *
 * The email MUST be the WorkOS-verified one (resolveVerifiedEmail), never a
 * client-supplied value: invites are matched by email, so a spoofed email
 * would let any caller see another person's pending invites.
 *
 * Ordered oldest-first so the list is deterministic, not planner-dependent.
 */
export async function getPendingInvitesForEmail(email: string): Promise<PendingInvite[]> {
  const now = new Date();

  return db
    .select({
      id: teamInvites.id,
      org_id: teamInvites.org_id,
      org_name: organizations.name,
      role: teamInvites.role,
      expires_at: teamInvites.expires_at,
      created_at: teamInvites.created_at,
    })
    .from(teamInvites)
    .innerJoin(organizations, eq(teamInvites.org_id, organizations.id))
    .where(
      and(
        eq(teamInvites.email, email),
        eq(teamInvites.status, 'pending'),
        gt(teamInvites.expires_at, now)
      )
    )
    .orderBy(asc(teamInvites.created_at));
}
