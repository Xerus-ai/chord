import { Router } from 'express';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import { registerGeneralAccessRoutes } from './general-access-routes.js';
import { registerMemberRoutes } from './member-routes.js';
import { registerMentionRoute } from './mention-route.js';
import { artifactScope, workItemScope, type ResourceScope } from './resource-scope.js';
import { registerSharingStateRoute } from './sharing-state-route.js';
import { registerStopSharingRoute } from './stop-sharing-route.js';

/**
 * P6 sharing routes — one set, two mounts: /work-items/:work_item_id and
 * /work-items/:work_item_id/artifacts/:artifact_id. Design:
 * the P6 sharing design §4.
 */
function createScopedSharingRouter(
  scope: ResourceScope,
  connectionManager: ConnectionManager
): Router {
  const router = Router({ mergeParams: true });
  registerSharingStateRoute(router, scope);
  registerMemberRoutes(router, scope, connectionManager);
  registerGeneralAccessRoutes(router, scope, connectionManager);
  registerStopSharingRoute(router, scope, connectionManager);
  if (scope.kind === 'work_item') registerMentionRoute(router, scope, connectionManager);
  return router;
}

export function createWorkItemSharingRouter(connectionManager: ConnectionManager): Router {
  return createScopedSharingRouter(workItemScope, connectionManager);
}

export function createArtifactSharingRouter(connectionManager: ConnectionManager): Router {
  return createScopedSharingRouter(artifactScope, connectionManager);
}
