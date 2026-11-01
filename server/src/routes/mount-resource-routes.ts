import type { Express } from 'express';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { createAgentEditsRouter } from './agent-edits.js';
import { createArtifactSummaryRouter } from './artifact-summary.js';
import { createArtifactsRouter } from './artifacts.js';
import { createDeviceCommandsRouter } from './commands-device.js';
import { createWorkItemCommandsRouter } from './commands.js';
import { createCommentImportRouter } from './comment-import.js';
import { createCommentsRouter } from './comments.js';
import { createGitStateRouter } from './git-state.js';
import { createMessagesRouter } from './messages.js';
import { notificationsRouter } from './notifications.js';
import { createOrganizationsRouter } from './organizations.js';
import { createPermissionRequestsRouter } from './permission-requests.js';
import { createPlanRequestsRouter } from './plan-requests.js';
import { presenceRouter } from './presence.js';
import { createPublicLinkCommentsRouter } from './public-link-comments.js';
import { createPublicLinkResolveRouter } from './public-link-resolve.js';
import { createArtifactSharingRouter, createWorkItemSharingRouter } from './sharing/index.js';
import { createSharedByMeRouter } from './sharing/shared-by-me-route.js';
import { createVersionsRouter } from './versions.js';
import { createWorkItemSessionsRouter } from './work-item-sessions.js';
import { createWorkItemWorktreesRouter } from './work-item-worktrees.js';
import { createWorkItemsRouter } from './work-items.js';

/**
 * Every authenticated route over work items, artifacts, sharing and teams —
 * the ones the access resolver (access/) gates. Mounted by server.ts after
 * requireAuth, and by the real-DB route tests, so tests exercise the
 * production wiring rather than a hand-assembled copy.
 */
export function mountResourceRoutes(app: Express, connectionManager: ConnectionManager): void {
  app.use('/work-items', createWorkItemsRouter(connectionManager));
  app.use('/work-items/:work_item_id/messages', createMessagesRouter(connectionManager));
  app.use('/work-items/:work_item_id/commands', createWorkItemCommandsRouter(connectionManager));
  app.use(
    '/work-items/:work_item_id/permission-requests',
    createPermissionRequestsRouter(connectionManager)
  );
  app.use('/work-items/:work_item_id/plan-requests', createPlanRequestsRouter(connectionManager));
  // Device-only surface (fetch/claim/ack) — creator-gated inline, not
  // work-item-path-scoped: a fetch spans many work items in one request.
  app.use('/commands', createDeviceCommandsRouter(connectionManager));
  app.use('/work-items/:work_item_id/git-state', createGitStateRouter(connectionManager));
  app.use('/work-items/:work_item_id/worktrees', createWorkItemWorktreesRouter(connectionManager));
  app.use('/work-items/:work_item_id/sessions', createWorkItemSessionsRouter(connectionManager));
  app.use(
    '/work-items/:work_item_id/artifacts/:artifact_id',
    createArtifactSharingRouter(connectionManager)
  );
  app.use('/work-items/:work_item_id', createWorkItemSharingRouter(connectionManager));
  app.use('/work-items/:work_item_id/artifact-summary', createArtifactSummaryRouter());
  app.use('/work-items/:work_item_id/artifacts', createCommentsRouter(connectionManager));
  app.use('/work-items/:work_item_id/artifacts', createCommentImportRouter(connectionManager));
  app.use('/work-items/:work_item_id/artifacts', createVersionsRouter(connectionManager));
  app.use('/artifacts', createArtifactsRouter());
  app.use('/sharing', createSharedByMeRouter());
  app.use('/public-links/:token/comments', createPublicLinkCommentsRouter(connectionManager));
  app.use('/public-links/:token/resolve', createPublicLinkResolveRouter());
  app.use('/organizations', createOrganizationsRouter(connectionManager));
  app.use('/presence', presenceRouter);
  app.use('/agent-edits', createAgentEditsRouter(connectionManager));
  app.use('/notifications', notificationsRouter);
}
