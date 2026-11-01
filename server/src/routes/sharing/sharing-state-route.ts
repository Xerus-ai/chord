import { eq } from 'drizzle-orm';
import type { Request, Router } from 'express';
import { artifactAccessOf, workItemAccessOf } from '../../access/access-middleware.js';
import type { AccessRole } from '../../access/resolve-access.js';
import { db } from '../../db/client.js';
import { artifacts } from '../../db/schema-artifacts.js';
import { users, workItems } from '../../db/schema.js';
import {
  listArtifactOnlyMembers,
  listMembers,
  loadResourceContext,
  loadTeam,
} from './resource-members.js';
import type { ResourceRef, ResourceScope } from './resource-scope.js';
import { findLiveShareLink, teamAllowsPublicLinks, toShareLinkView } from './share-links.js';

/**
 * GET /sharing — everything the share popover shows, in one request: the
 * author, "who has access", the members, whether the team allows public
 * links, and (author only) the live public link. Anyone with access may read
 * it. For an artifact, the work item's own access is included only for callers
 * who hold work-item access — an artifact-only member learns nothing about
 * who is on the work item. For a work item, its author also reads who holds
 * only some of its artifacts (`artifact_members`); nobody else does, since
 * this state feeds everyone's mention roster.
 */
export function registerSharingStateRoute(router: Router, scope: ResourceScope): void {
  router.get('/sharing', scope.requireRole('view'), async (req, res) => {
    const ref = scope.refOf(req);
    const callerRole = callerRoleOf(req, scope);
    const context = await loadResourceContext(ref);

    const [author] = await db
      .select({
        user_id: users.id,
        email: users.email,
        name: users.name,
        avatar_url: users.avatar_url,
      })
      .from(users)
      .where(eq(users.id, context.authorId))
      .limit(1);
    if (!author) throw new Error(`[sharing] author ${context.authorId} has no user row`);

    const general = await loadGeneralAccess(ref);
    const liveLink =
      ref.artifactId && callerRole === 'author' ? await findLiveShareLink(ref.artifactId) : null;
    const inheritsFromWorkItem =
      ref.artifactId !== null && artifactAccessOf(req).work_item_role !== null;

    res.json({
      caller_role: callerRole,
      author,
      team: await loadTeam(context.orgId),
      general_access: general.general_access,
      general_role: general.general_role,
      members: await listMembers(ref),
      artifact_members:
        ref.artifactId === null && callerRole === 'author'
          ? await listArtifactOnlyMembers(ref.workItemId)
          : [],
      team_allows_public_links: await teamAllowsPublicLinks(context.orgId),
      link: liveLink ? toShareLinkView(liveLink) : null,
      work_item: inheritsFromWorkItem ? await describeWorkItemAccess(ref.workItemId) : null,
    });
  });
}

function callerRoleOf(req: Request, scope: ResourceScope): AccessRole {
  return scope.kind === 'artifact' ? artifactAccessOf(req).role : workItemAccessOf(req).role;
}

async function loadGeneralAccess(
  ref: ResourceRef
): Promise<{ general_access: string; general_role: string }> {
  const [row] = ref.artifactId
    ? await db
        .select({ general_access: artifacts.general_access, general_role: artifacts.general_role })
        .from(artifacts)
        .where(eq(artifacts.id, ref.artifactId))
        .limit(1)
    : await db
        .select({ general_access: workItems.general_access, general_role: workItems.general_role })
        .from(workItems)
        .where(eq(workItems.id, ref.workItemId))
        .limit(1);
  if (!row) throw new Error('[sharing] resource vanished mid-request');
  return row;
}

async function describeWorkItemAccess(workItemId: string) {
  const ref = { workItemId, artifactId: null };
  const [general, context] = await Promise.all([loadGeneralAccess(ref), loadResourceContext(ref)]);
  return {
    id: workItemId,
    name: context.name,
    general_access: general.general_access,
    general_role: general.general_role,
    members: await listMembers(ref),
  };
}
