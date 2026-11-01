import { WorkOS } from '@workos-inc/node';
import { and, asc, eq, notLike } from 'drizzle-orm';
import type { Express } from 'express';
import { activatePendingMembers } from '../access/activate-pending-members.js';
import { db, hasDb } from '../db/client.js';
import { organizations, orgMemberships, users } from '../db/schema.js';
import { resolveAdoptedOrgName } from '../lib/org-name.js';
import { resolveVerifiedEmail } from '../lib/verified-email.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { syncProfileRateLimiter } from '../middleware/rate-limit.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { announceActivatedMembers } from './sharing/announce-member-change.js';

/**
 * POST /auth/sync-profile: the signed-in desktop's profile and team, written
 * to the server's users, organizations and memberships, and the shares
 * waiting on this email activated (split from server.ts). Mounted after
 * requireAuth.
 */
export function registerSyncProfileRoute(app: Express, connectionManager: ConnectionManager) {
  app.post('/auth/sync-profile', syncProfileRateLimiter, async (req, res) => {
    const { user } = req as AuthenticatedRequest;

    if (!hasDb) {
      res.json({ status: 'ok', org_id: user.orgId });
      return;
    }

    // org_name is deliberately NOT read from the body: the org display name
    // is resolved authoritatively below (clients historically sent the bare
    // email domain, which is how a real org ended up named "gmail.com").
    const { name, avatar_url, org_id } = req.body as {
      name?: string;
      avatar_url?: string;
      org_id?: string;
    };

    // Identity email is NEVER sourced from the request body: `users.email` is
    // the UNIQUE identity key AND the share-by-email auto-accept target below,
    // so a spoofed body email would let any caller claim another user's
    // pending shares and impersonate them as sender/author. It is resolved
    // authoritatively from WorkOS via the verified token subject (the access
    // token itself carries no email — see middleware/auth.ts). Fail closed:
    // without an authoritative email we write no email and accept no shares.
    const email = await resolveVerifiedEmail(user.userId);

    if (email) {
      await db
        .update(users)
        .set({
          email,
          name: name ?? null,
          avatar_url: avatar_url ?? null,
        })
        .where(eq(users.id, user.userId));
    }

    // Trust order for org membership, most to least authoritative. A
    // client-supplied `org_id` in the request body is NEVER on its own
    // sufficient to join an org that already exists — it's unauthenticated
    // input and trusting it let any caller name a victim org and become its
    // owner (onConflictDoNothing on the (user_id, org_id) PK still wrote the
    // membership row).
    //
    // 1. The org_id claim on the verified WorkOS JWT, when a session IS
    //    org-scoped. WorkOS itself attests the caller belongs to this org.
    // 2. A body org_id the caller ALREADY holds a membership in — the
    //    active-workspace switch (e.g. just-accepted invite). Membership is
    //    verified against our own DB, so this is authoritative, not the naked
    //    body-org_id trust the block below still fails closed on.
    // 3. Otherwise the caller's oldest non-personal org membership.
    let effectiveOrgId: string | null = user.orgId ?? null;

    // Honor an explicit body org_id when — and only when — the caller is a
    // member of it, so a member of several orgs can switch active workspace by
    // syncing with org_id=B. A non-member org_id is ignored here and falls
    // through to the fail-closed check below.
    if (!effectiveOrgId && org_id) {
      const [membership] = await db
        .select({ org_id: orgMemberships.org_id })
        .from(orgMemberships)
        .where(and(eq(orgMemberships.user_id, user.userId), eq(orgMemberships.org_id, org_id)))
        .limit(1);
      if (membership) effectiveOrgId = membership.org_id;
    }

    if (!effectiveOrgId) {
      // Personal orgs are excluded in the WHERE, never filtered after a bare
      // LIMIT 1: that shape fetched whichever membership row the planner
      // returned first (in practice the older personal-org row), discarded
      // it, and left callers with a real org membership unresolved forever —
      // every owner sync cycle re-posted here, got org_id null back, and the
      // client's durable queue never drained (NEW-6). ORDER BY makes the
      // pick deterministic for multi-org members: WorkOS org ids are
      // ULID-suffixed, so ascending id = oldest org.
      const [existing] = await db
        .select({ org_id: orgMemberships.org_id })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.user_id, user.userId),
            notLike(orgMemberships.org_id, 'personal\\_%')
          )
        )
        .orderBy(asc(orgMemberships.org_id))
        .limit(1);

      if (existing) effectiveOrgId = existing.org_id;
    }

    let isNewOrg = false;
    let createdOrgName: string | null = null;
    const workosClient = process.env.WORKOS_API_KEY ? new WorkOS(process.env.WORKOS_API_KEY) : null;

    if (!effectiveOrgId && org_id) {
      const [existingOrg] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, org_id))
        .limit(1);

      if (existingOrg) {
        // Org exists but neither the verified claim nor our own membership
        // table ties this caller to it. Fail closed — no row written.
        res.status(403).json({ error: 'Not authorized to join this organization' });
        return;
      }
      // org_id doesn't correspond to any org we know about. It's client-
      // invented and untrusted, so it's discarded rather than used to seed a
      // new org row — new orgs only ever get an id WorkOS assigns, below.
    }

    if (!effectiveOrgId && workosClient) {
      const displayName = name ?? email ?? user.userId;
      const workosOrg = await workosClient.organizations.createOrganization({
        name: `${displayName}'s workspace`,
      });
      effectiveOrgId = workosOrg.id;
      createdOrgName = workosOrg.name;
      isNewOrg = true;
    }

    if (!effectiveOrgId) {
      res.json({ status: 'ok', org_id: null });
      return;
    }

    // A just-created org keeps the name it was created with in WorkOS; an
    // org we've never stored (first sign-in from an existing WorkOS org)
    // gets its authoritative WorkOS name, with a derived fallback only when
    // no server API key is configured. Membership-resolved orgs always have
    // a stored row already (org_memberships.org_id references organizations).
    const [storedOrg] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, effectiveOrgId))
      .limit(1);

    if (!storedOrg) {
      const derivedName = `${name ?? email ?? user.userId}'s workspace`;
      let orgName: string;

      if (createdOrgName) {
        orgName = createdOrgName;
      } else if (workosClient) {
        // WorkOS names an org it created itself after the signup email's
        // domain, which is how accounts ended up in a workspace called
        // "gmail.com". Adopting that verbatim is the bug; overriding it is
        // limited to consumer domains (see resolveAdoptedOrgName).
        const workosName = (await workosClient.organizations.getOrganization(effectiveOrgId)).name;
        orgName = resolveAdoptedOrgName(workosName, email, name ?? email ?? user.userId);
        // Write through, so the override doesn't diverge our row from WorkOS —
        // the same discipline the rename route follows.
        if (orgName !== workosName) {
          await workosClient.organizations.updateOrganization({
            organization: effectiveOrgId,
            name: orgName,
          });
        }
      } else {
        orgName = derivedName;
      }

      await db
        .insert(organizations)
        .values({ id: effectiveOrgId, name: orgName })
        .onConflictDoNothing();
    }

    // Only the caller that just bootstrapped a brand-new org becomes its
    // owner. Joining an org that already existed (via verified claim or
    // existing membership) must not silently grant ownership — the `role`
    // column defaults to 'member' when omitted.
    await db
      .insert(orgMemberships)
      .values(
        isNewOrg
          ? { user_id: user.userId, org_id: effectiveOrgId, role: 'owner' }
          : { user_id: user.userId, org_id: effectiveOrgId }
      )
      .onConflictDoNothing();

    // Pending shares addressed to this email (invited from outside the team)
    // become real members now that the invitee is in the team.
    if (email) {
      const activated = await activatePendingMembers(user.userId, email);
      await announceActivatedMembers(connectionManager, user.userId, email, activated);
    }

    res.json({ status: 'ok', org_id: effectiveOrgId });
  });
}
