import { WorkOS } from '@workos-inc/node';

// WorkOS is the source of truth for org identity and membership, so the
// lifecycle mutations (a user joins, is removed, or has a pending invite
// revoked) mirror through to it. Unlike the create/invite routes — which gate
// on WorkOS up front with a 503 because WorkOS assigns the id and sends the
// email — these helpers run AFTER the local DB write has already committed.
// That ordering is deliberate: the local row is what the app reads, so a
// WorkOS hiccup must be LOUD but must NOT throw. A post-commit throw would
// surface as a 500 and falsely tell the caller the whole action failed while
// the authoritative local state already changed.
//
// When WORKOS_API_KEY is absent (local dev) each helper no-ops with a loud
// log — the same posture as `organizations.ts` `requireWorkOS`, minus the HTTP
// response since these are not route handlers.
const workos = process.env.WORKOS_API_KEY ? new WorkOS(process.env.WORKOS_API_KEY) : null;

function logSkipped(action: string): void {
  console.warn(`[org-membership] ${action} skipped: WORKOS_API_KEY not configured`);
}

function logFailed(action: string, err: unknown): void {
  console.error(`[org-membership] ${action} failed:`, err instanceof Error ? err.message : err);
}

/**
 * Mirrors an accepted invite into WorkOS by creating the organization
 * membership. `userId` is the WorkOS-verified subject (our `users.id` is the
 * WorkOS user id), so it maps directly to WorkOS's `userId`.
 */
export async function createWorkosMembership(orgId: string, userId: string): Promise<void> {
  const action = `createOrganizationMembership org=${orgId} user=${userId}`;
  if (!workos) {
    logSkipped(action);
    return;
  }
  try {
    await workos.userManagement.createOrganizationMembership({
      organizationId: orgId,
      userId,
    });
  } catch (err) {
    logFailed(action, err);
  }
}

/**
 * Mirrors a member removal into WorkOS. WorkOS keys deactivation on the
 * membership id, not (org, user), so the membership is looked up first.
 */
export async function deactivateWorkosMembership(orgId: string, userId: string): Promise<void> {
  const action = `deactivateOrganizationMembership org=${orgId} user=${userId}`;
  if (!workos) {
    logSkipped(action);
    return;
  }
  try {
    const memberships = await workos.userManagement.listOrganizationMemberships({
      organizationId: orgId,
      userId,
    });
    const membership = memberships.data[0];
    if (!membership) {
      console.warn(`[org-membership] ${action}: no matching WorkOS membership found`);
      return;
    }
    await workos.userManagement.deactivateOrganizationMembership(membership.id);
  } catch (err) {
    logFailed(action, err);
  }
}

/**
 * Mirrors a revoked invite into WorkOS. WorkOS keys revocation on the
 * invitation id, so the pending invitation for (email, org) is looked up first.
 */
export async function revokeWorkosInvitation(email: string, orgId: string): Promise<void> {
  const action = `revokeInvitation org=${orgId} email=${email}`;
  if (!workos) {
    logSkipped(action);
    return;
  }
  try {
    const invitations = await workos.userManagement.listInvitations({
      organizationId: orgId,
      email,
    });
    const pending = invitations.data.find((invite) => invite.state === 'pending');
    if (!pending) {
      console.warn(`[org-membership] ${action}: no pending WorkOS invitation found`);
      return;
    }
    await workos.userManagement.revokeInvitation(pending.id);
  } catch (err) {
    logFailed(action, err);
  }
}
