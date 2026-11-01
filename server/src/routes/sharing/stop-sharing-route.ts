import type { Router } from 'express';
import { recheckLiveAccess } from '../../access/recheck-live-access.js';
import { recordAccessEvent } from '../../access/record-access-event.js';
import { db } from '../../db/client.js';
import { resourceMembers } from '../../db/schema-sharing.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import { announceMemberChange } from './announce-member-change.js';
import {
  announceArtifactGeneralAccess,
  applyArtifactGeneralAccess,
  applyWorkItemGeneralAccess,
} from './general-access-routes.js';
import { listMembers, membersOf } from './resource-members.js';
import type { ResourceScope } from './resource-scope.js';

/**
 * DELETE /sharing — "Stop sharing" (You › Sharing › Revoke): every member is
 * removed, general access returns to "Only people invited" and a public link
 * is revoked. The resource itself is untouched; for an artifact, access
 * inherited from its work item stays (it can never hide from those members).
 * Author only.
 */
export function registerStopSharingRoute(
  router: Router,
  scope: ResourceScope,
  connectionManager: ConnectionManager
): void {
  router.delete('/sharing', scope.requireRole('author'), async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const ref = scope.refOf(req);
    const members = await listMembers(ref);

    await db.delete(resourceMembers).where(membersOf(ref));
    for (const member of members) {
      await recordAccessEvent({
        workItemId: ref.workItemId,
        artifactId: ref.artifactId,
        actorId: user.userId,
        action: 'member_removed',
        subjectUserId: member.user_id,
        subjectEmail: member.email,
        role: member.role,
      });
    }

    const invited = { general_access: 'invited', general_role: 'view' } as const;
    if (ref.artifactId) {
      await applyArtifactGeneralAccess(ref, ref.artifactId, invited, user.userId);
    } else {
      await applyWorkItemGeneralAccess(ref, invited, user.userId, connectionManager);
    }
    await recordAccessEvent({
      workItemId: ref.workItemId,
      artifactId: ref.artifactId,
      actorId: user.userId,
      action: 'general_access_changed',
      role: 'view',
    });

    await recheckLiveAccess(connectionManager, ref.workItemId);
    if (ref.artifactId) announceArtifactGeneralAccess(connectionManager, ref, ref.artifactId);
    for (const member of members) {
      if (!member.user_id) continue;
      await announceMemberChange(connectionManager, {
        ref,
        userId: member.user_id,
        email: member.email,
        role: null,
        previousRole: member.role,
        sharerId: user.userId,
      });
    }
    res.status(204).end();
  });
}
