import type { Request, RequestHandler } from 'express';
import { requireArtifactRole, requireWorkItemRole } from '../../access/access-middleware.js';
import type { AccessRole } from '../../access/resolve-access.js';

/**
 * Work items and artifacts share every sharing route (members, general
 * access, sharing state) — only the path and the gate differ. A scope names
 * both, so each route is written once.
 */

export interface ResourceRef {
  workItemId: string;
  /** null = the work item itself. */
  artifactId: string | null;
}

export interface ResourceScope {
  kind: 'work_item' | 'artifact';
  requireRole(minimum: AccessRole): RequestHandler;
  refOf(req: Request): ResourceRef;
}

function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`[sharing] missing route param ${name}`);
  return value;
}

/** Mounted at /work-items/:work_item_id. */
export const workItemScope: ResourceScope = {
  kind: 'work_item',
  requireRole: (minimum) => requireWorkItemRole(minimum) as RequestHandler,
  refOf: (req) => ({ workItemId: param(req, 'work_item_id'), artifactId: null }),
};

/** Mounted at /work-items/:work_item_id/artifacts/:artifact_id. */
export const artifactScope: ResourceScope = {
  kind: 'artifact',
  requireRole: (minimum) => requireArtifactRole(minimum) as RequestHandler,
  refOf: (req) => ({
    workItemId: param(req, 'work_item_id'),
    artifactId: param(req, 'artifact_id'),
  }),
};
