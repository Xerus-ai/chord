import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Router } from 'express';
import { z } from 'zod';
import { recheckLiveAccess } from '../../access/recheck-live-access.js';
import { recordAccessEvent } from '../../access/record-access-event.js';
import type { MemberRole, WorkItemGeneralAccess } from '../../access/resolve-access.js';
import { db } from '../../db/client.js';
import { artifacts } from '../../db/schema-artifacts.js';
import { shareLinks } from '../../db/schema-sharing.js';
import { workItems } from '../../db/schema.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { artifactRoomId, workItemRoomId } from '../../ws/authorize.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import { loadResourceContext } from './resource-members.js';
import type { ResourceRef, ResourceScope } from './resource-scope.js';
import { saveLinkVersion } from './save-link-version.js';
import {
  ensureShareLink,
  findLiveShareLink,
  revokeShareLink,
  teamAllowsPublicLinks,
  toShareLinkView,
} from './share-links.js';

const GeneralAccessSchema = z.object({
  general_access: z.enum(['invited', 'team', 'link']),
  general_role: z.enum(['view', 'edit']),
});

const LinkSettingsSchema = z.object({ comments_enabled: z.boolean() });

/**
 * "Who has access" for one scope. Only people invited · Anyone in the team
 * (view or edit) · Anyone with the link — artifacts only, view-only, and only
 * while the team allows public links. Entering 'link' creates the public link;
 * leaving it revokes the link. Author only.
 */
export function registerGeneralAccessRoutes(
  router: Router,
  scope: ResourceScope,
  connectionManager: ConnectionManager
): void {
  router.patch('/general-access', scope.requireRole('author'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const parsed = GeneralAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { general_access, general_role } = parsed.data;
    const ref = scope.refOf(req);

    if (general_access === 'link' && !ref.artifactId) {
      res.status(400).json({ error: 'A work item cannot be shared publicly' });
      return;
    }
    if (general_access === 'link' && general_role !== 'view') {
      res.status(400).json({ error: 'A public link is view-only' });
      return;
    }
    if (general_access === 'link') {
      const context = await loadResourceContext(ref);
      if (!(await teamAllowsPublicLinks(context.orgId))) {
        res.status(403).json({
          error: 'Your team has turned off public links',
          code: 'PUBLIC_LINKS_DISABLED',
        });
        return;
      }
    }

    let link: { id: string; comments_enabled: boolean } | null = null;
    if (ref.artifactId) {
      link = await applyArtifactGeneralAccess(ref, ref.artifactId, parsed.data, user.userId);
      if (general_access === 'link') {
        await saveLinkVersion(connectionManager, ref.workItemId, ref.artifactId, user);
      }
    } else if (general_access !== 'link') {
      await applyWorkItemGeneralAccess(
        ref,
        { general_access, general_role },
        user.userId,
        connectionManager
      );
    }

    await recordAccessEvent({
      workItemId: ref.workItemId,
      artifactId: ref.artifactId,
      actorId: user.userId,
      action: 'general_access_changed',
      role: general_role,
    });
    await recheckLiveAccess(connectionManager, ref.workItemId);
    if (ref.artifactId) announceArtifactGeneralAccess(connectionManager, ref, ref.artifactId);

    res.json({ general_access, general_role, link: link ? toShareLinkView(link) : null });
  });

  if (scope.kind !== 'artifact') return;

  router.patch('/link', scope.requireRole('author'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const parsed = LinkSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const ref = scope.refOf(req);
    const artifactId = ref.artifactId!;
    const [link] = await db
      .update(shareLinks)
      .set({ comments_enabled: parsed.data.comments_enabled })
      .where(and(eq(shareLinks.artifact_id, artifactId), isNull(shareLinks.revoked_at)))
      .returning({ id: shareLinks.id, comments_enabled: shareLinks.comments_enabled });
    if (!link) {
      res.status(404).json({ error: 'This artifact has no public link' });
      return;
    }
    await recordAccessEvent({
      workItemId: ref.workItemId,
      artifactId,
      actorId: user.userId,
      action: 'link_comments_changed',
    });
    res.json(toShareLinkView(link));
  });
}

export async function applyWorkItemGeneralAccess(
  ref: ResourceRef,
  access: { general_access: WorkItemGeneralAccess; general_role: MemberRole },
  actorId: string,
  connectionManager: ConnectionManager
): Promise<void> {
  const [updated] = await db
    .update(workItems)
    .set({
      general_access: access.general_access,
      general_role: access.general_role,
      updated_at: new Date(),
      version_number: sql`${workItems.version_number} + 1`,
    })
    .where(eq(workItems.id, ref.workItemId))
    .returning({ version_number: workItems.version_number, updated_at: workItems.updated_at });
  if (!updated) throw new Error(`[sharing] work item vanished mid-request: ${ref.workItemId}`);

  connectionManager.broadcastToRoom(workItemRoomId(ref.workItemId), {
    type: 'work_item_updated',
    payload: {
      work_item_id: ref.workItemId,
      changes: { general_access: access.general_access, general_role: access.general_role },
      version_number: updated.version_number,
      updated_by: actorId,
      updated_at: updated.updated_at.toISOString(),
    },
  });
}

export async function applyArtifactGeneralAccess(
  ref: ResourceRef,
  artifactId: string,
  access: z.infer<typeof GeneralAccessSchema>,
  actorId: string
): Promise<{ id: string; comments_enabled: boolean } | null> {
  await db
    .update(artifacts)
    .set({
      general_access: access.general_access,
      general_role: access.general_role,
      updated_at: new Date(),
    })
    .where(eq(artifacts.id, artifactId));

  if (access.general_access === 'link') return ensureShareLink(ref.workItemId, artifactId, actorId);
  await revokeShareLink(ref.workItemId, artifactId, actorId);
  return findLiveShareLink(artifactId);
}

export function announceArtifactGeneralAccess(
  connectionManager: ConnectionManager,
  ref: ResourceRef,
  artifactId: string
): void {
  const event = {
    type: 'artifact_access_changed' as const,
    payload: { work_item_id: ref.workItemId, artifact_id: artifactId, user_id: null },
  };
  connectionManager.broadcastToRoom(artifactRoomId(artifactId), event);
  connectionManager.broadcastToRoom(workItemRoomId(ref.workItemId), event);
}
