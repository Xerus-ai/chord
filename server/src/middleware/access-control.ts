import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/client.js';
import { orgMemberships } from '../db/schema.js';
import { DEV_MODE, type AuthenticatedRequest } from './auth.js';

export interface OrgScopedRequest extends AuthenticatedRequest {
  orgMembership: typeof orgMemberships.$inferSelect;
}

export function requireOrgMembership(req: Request, res: Response, next: NextFunction): void {
  if (DEV_MODE) {
    // The bypass must still populate orgMembership: downstream handlers read
    // orgMembership.role for admin checks, and leaving it unset made every
    // role-gated org route crash with a TypeError in local dev.
    const { user } = req as unknown as AuthenticatedRequest;
    const rawOrgId = req.params.org_id;
    const orgId = Array.isArray(rawOrgId) ? rawOrgId[0] : rawOrgId;
    (req as unknown as OrgScopedRequest).orgMembership = {
      user_id: user?.userId ?? 'dev-user-local',
      org_id: orgId ?? user?.orgId ?? 'dev-org-local',
      role: 'owner',
    };
    next();
    return;
  }

  const { user } = req as unknown as AuthenticatedRequest;
  const rawOrgId = req.params.org_id;
  const orgId = Array.isArray(rawOrgId) ? rawOrgId[0] : rawOrgId;

  if (!orgId) {
    res.status(400).json({ error: 'Missing organization ID' });
    return;
  }

  // Promise.resolve() first so a synchronous throw (e.g. an unavailable DB
  // handle) lands in the catch below as a 500 instead of escaping the
  // middleware.
  Promise.resolve()
    .then(() =>
      db
        .select()
        .from(orgMemberships)
        .where(and(eq(orgMemberships.org_id, orgId), eq(orgMemberships.user_id, user.userId)))
        .limit(1)
    )
    .then(([membership]) => {
      if (!membership) {
        res.status(403).json({ error: 'Not a member of this organization' });
        return;
      }
      (req as unknown as OrgScopedRequest).orgMembership = membership;
      next();
    })
    .catch((err) => {
      console.error('[access-control] org membership check failed:', err.message);
      res.status(500).json({ error: 'Access check failed' });
    });
}
