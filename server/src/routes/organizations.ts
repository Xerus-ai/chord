import { WorkOS } from '@workos-inc/node';
import { eq } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { db, hasDb } from '../db/client.js';
import { teamInvites } from '../db/schema-sharing.js';
import { organizations, orgMemberships, users } from '../db/schema.js';
import { inviteToTeam } from '../lib/team-invites.js';
import { requireOrgMembership, type OrgScopedRequest } from '../middleware/access-control.js';
import { type AuthenticatedRequest } from '../middleware/auth.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { createOrgLifecycleRouter } from './org-lifecycle.js';
import { createOrgSharingPolicyRouter } from './org-sharing-policy.js';

const workos = process.env.WORKOS_API_KEY ? new WorkOS(process.env.WORKOS_API_KEY) : null;

const CreateOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

const RenameOrgSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const InviteMemberSchema = z.object({
  email: z.email(),
  role: z.enum(['admin', 'member']).default('member'),
});

// Org mutations write through to WorkOS (it is the source of truth for org
// identity and invitation emails), so routes that mutate refuse to run
// half-way without an API key instead of diverging the two systems.
function requireWorkOS(res: Response): WorkOS | null {
  if (!workos) {
    res.status(503).json({ error: 'WORKOS_API_KEY is not configured on this server' });
    return null;
  }
  return workos;
}

export function createOrganizationsRouter(connectionManager: ConnectionManager): Router {
  const router = Router();

  // DB-backed only — but deliberately NOT gated on DEV_MODE: a dev running
  // with a database gets the full team surface (requireOrgMembership already
  // handles DEV_MODE), and gating on DEV_MODE here made every org route 503
  // locally, leaving the invite flow untestable.
  router.use((_req, res, next) => {
    if (!hasDb) {
      res.status(503).json({ error: 'Organizations require a database' });
      return;
    }
    next();
  });

  // Invite acceptance/decline and member remove/leave live in their own router
  // on this same base. Mounted before the param routes so `/invites/mine` and
  // `/invites/:invite_id/accept` resolve ahead of any `/:org_id` pattern.
  router.use(createOrgLifecycleRouter(connectionManager));
  router.use(createOrgSharingPolicyRouter());

  router.get('/', async (req, res) => {
    const { user } = req as AuthenticatedRequest;

    const memberships = await db
      .select({
        org_id: orgMemberships.org_id,
        role: orgMemberships.role,
        name: organizations.name,
        slug: organizations.slug,
        created_at: organizations.created_at,
      })
      .from(orgMemberships)
      .innerJoin(organizations, eq(orgMemberships.org_id, organizations.id))
      .where(eq(orgMemberships.user_id, user.userId));

    res.json(memberships);
  });

  router.post('/', async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const parsed = CreateOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const workosClient = requireWorkOS(res);
    if (!workosClient) return;

    const workosOrg = await workosClient.organizations.createOrganization({
      name: parsed.data.name,
    });

    await db.insert(organizations).values({
      id: workosOrg.id,
      name: workosOrg.name,
      slug: parsed.data.slug ?? null,
    });

    await db.insert(orgMemberships).values({
      user_id: user.userId,
      org_id: workosOrg.id,
      role: 'owner',
    });

    res.status(201).json({
      id: workosOrg.id,
      name: workosOrg.name,
      slug: parsed.data.slug ?? null,
      role: 'owner',
    });
  });

  // Renames the org in WorkOS first (source of truth), then mirrors the name
  // locally. This is what the onboarding "name your workspace" step calls to
  // replace the auto-generated "<name>'s workspace".
  router.patch('/:org_id', requireOrgMembership, async (req, res) => {
    const { orgMembership } = req as unknown as OrgScopedRequest;
    const org_id = req.params.org_id as string;
    const parsed = RenameOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    if (orgMembership.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can rename the organization' });
      return;
    }

    const workosClient = requireWorkOS(res);
    if (!workosClient) return;

    await workosClient.organizations.updateOrganization({
      organization: org_id,
      name: parsed.data.name,
    });

    await db
      .update(organizations)
      .set({ name: parsed.data.name })
      .where(eq(organizations.id, org_id));

    res.json({ id: org_id, name: parsed.data.name });
  });

  router.get('/:org_id/members', requireOrgMembership, async (req, res) => {
    const org_id = req.params.org_id as string;

    const members = await db
      .select({
        user_id: orgMemberships.user_id,
        role: orgMemberships.role,
        email: users.email,
        name: users.name,
        avatar_url: users.avatar_url,
      })
      .from(orgMemberships)
      .innerJoin(users, eq(orgMemberships.user_id, users.id))
      .where(eq(orgMemberships.org_id, org_id));

    res.json(members);
  });

  router.post('/:org_id/invites', requireOrgMembership, async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const { orgMembership } = req as unknown as OrgScopedRequest;
    const parsed = InviteMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    if (orgMembership.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can invite members' });
      return;
    }

    const result = await inviteToTeam(
      {
        orgId: req.params.org_id as string,
        inviterId: user.userId,
        email: parsed.data.email,
        role: parsed.data.role,
      },
      connectionManager
    );
    res.status(result.status).json(result.body);
  });

  router.get('/:org_id/invites', requireOrgMembership, async (req, res) => {
    const org_id = req.params.org_id as string;

    const invites = await db.select().from(teamInvites).where(eq(teamInvites.org_id, org_id));

    res.json(invites);
  });

  return router;
}
