import { ARTIFACTS_ONLY_CODE } from '@chord/protocol';
import type { NextFunction, Request, Response } from 'express';
import { DEV_MODE, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  listArtifactsReachableAlone,
  resolveArtifactAccess,
  resolveWorkItemAccess,
  roleAtLeast,
  type AccessRole,
  type ArtifactAccess,
  type WorkItemAccess,
} from './resolve-access.js';

/**
 * Express gates over the one resolver. Anyone without access gets 404 — a
 * private work item or artifact is invisible, never "forbidden" — and a
 * caller whose role is too low gets 403. Someone who reaches only some of a
 * work item's artifacts (shared alone) knows the item exists, so its own
 * routes answer them 403 `ARTIFACTS_ONLY`, unless the route serves them
 * (`allowArtifactsOnly`). An unavailable database rejects with 500; only
 * DEV_MODE bypasses (as author).
 */

interface AccessScopedRequest extends AuthenticatedRequest {
  workItemAccess?: WorkItemAccess;
  artifactAccess?: ArtifactAccess;
  /** The artifacts an artifact-only caller reaches, set by requireWorkItemRole. */
  artifactsOnly?: string[];
}

export interface WorkItemRoleOptions {
  /**
   * Lets a caller who reaches only some of the item's artifacts through; the
   * handler answers them from `artifactsOnlyOf(req)`.
   */
  allowArtifactsOnly?: boolean;
}

const ROLE_REFUSALS: Record<AccessRole, string> = {
  view: 'Access denied',
  edit: 'Viewers have read-only access',
  author: 'Only the author can manage sharing',
};

function paramOf(req: Request, name: string): string | undefined {
  const raw = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function failAccessCheck(res: Response, err: unknown): void {
  console.error('[access] check failed:', err instanceof Error ? err.message : String(err));
  res.status(500).json({ error: 'Access check failed' });
}

/** Resolves the caller's access to `:work_item_id` (or `:id`) and requires `minimum`. */
export function requireWorkItemRole(minimum: AccessRole, options: WorkItemRoleOptions = {}) {
  return function requireWorkItemRoleMiddleware<P>(
    req: Request<P>,
    res: Response,
    next: NextFunction
  ): void {
    const scoped = req as unknown as AccessScopedRequest;
    const workItemId = paramOf(req as Request, 'work_item_id') ?? paramOf(req as Request, 'id');
    if (!workItemId) {
      res.status(400).json({ error: 'Missing work item ID' });
      return;
    }
    if (DEV_MODE) {
      scoped.workItemAccess = { role: 'author', source: 'author', work_item_id: workItemId };
      next();
      return;
    }

    const known = scoped.workItemAccess;
    const pending =
      known && known.work_item_id === workItemId
        ? Promise.resolve(known)
        : Promise.resolve().then(() => resolveWorkItemAccess(scoped.user.userId, workItemId));

    pending
      .then(async (access) => {
        if (access === 'not_found') {
          res.status(404).json({ error: 'Work item not found' });
          return;
        }
        if (access === null) {
          const reachable = await listArtifactsReachableAlone(scoped.user.userId, workItemId);
          if (reachable.length === 0) {
            res.status(404).json({ error: 'Work item not found' });
          } else if (options.allowArtifactsOnly) {
            scoped.artifactsOnly = reachable;
            next();
          } else {
            res.status(403).json({
              error: 'Only the artifacts shared with you are open to you',
              code: ARTIFACTS_ONLY_CODE,
            });
          }
          return;
        }
        scoped.workItemAccess = access;
        if (!roleAtLeast(access.role, minimum)) {
          res.status(403).json({ error: ROLE_REFUSALS[minimum] });
          return;
        }
        next();
      })
      .catch((err: unknown) => failAccessCheck(res, err));
  };
}

/**
 * Resolves the caller's access to `:artifact_id` and requires `minimum`. The
 * artifact must belong to the `:work_item_id` in the path; one that does not
 * is answered 404, so a path can never re-scope an artifact.
 */
export function requireArtifactRole(minimum: AccessRole) {
  return function requireArtifactRoleMiddleware<P>(
    req: Request<P>,
    res: Response,
    next: NextFunction
  ): void {
    const scoped = req as unknown as AccessScopedRequest;
    const artifactId = paramOf(req as Request, 'artifact_id');
    const workItemId = paramOf(req as Request, 'work_item_id');
    if (!artifactId) {
      res.status(400).json({ error: 'Missing artifact ID' });
      return;
    }
    if (DEV_MODE) {
      scoped.artifactAccess = {
        role: 'author',
        work_item_id: workItemId ?? '',
        work_item_role: 'author',
      };
      next();
      return;
    }

    Promise.resolve()
      .then(() => resolveArtifactAccess(scoped.user.userId, artifactId))
      .then((access) => {
        if (
          access === 'not_found' ||
          access === null ||
          (workItemId !== undefined && access.work_item_id !== workItemId)
        ) {
          res.status(404).json({ error: 'Artifact not found' });
          return;
        }
        scoped.artifactAccess = access;
        if (!roleAtLeast(access.role, minimum)) {
          res.status(403).json({ error: ROLE_REFUSALS[minimum] });
          return;
        }
        next();
      })
      .catch((err: unknown) => failAccessCheck(res, err));
  };
}

/**
 * The artifacts an artifact-only caller reaches, or null for a caller who
 * reaches the work item. Only routes gated with `allowArtifactsOnly` see one.
 */
export function artifactsOnlyOf(req: Request<unknown>): string[] | null {
  return (req as unknown as AccessScopedRequest).artifactsOnly ?? null;
}

/** The access requireWorkItemRole attached; throws if it did not run first. */
export function workItemAccessOf(req: Request<unknown>): WorkItemAccess {
  const access = (req as unknown as AccessScopedRequest).workItemAccess;
  if (!access) throw new Error('[access] workItemAccessOf used without requireWorkItemRole');
  return access;
}

/** The access requireArtifactRole attached; throws if it did not run first. */
export function artifactAccessOf(req: Request<unknown>): ArtifactAccess {
  const access = (req as unknown as AccessScopedRequest).artifactAccess;
  if (!access) throw new Error('[access] artifactAccessOf used without requireArtifactRole');
  return access;
}
