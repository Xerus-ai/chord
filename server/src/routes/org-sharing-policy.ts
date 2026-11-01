import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { organizations } from '../db/schema.js';
import { requireOrgMembership, type OrgScopedRequest } from '../middleware/access-control.js';

/**
 * Workspace › Team sharing switches (P6). Any member reads them — the share
 * dialog's Publish tab hides the public link when links are off, and every
 * publish from a device refuses when publishing to Confluence is off
 * (main/core/confluence/team-publishing-policy.ts). Only the team
 * owner changes them. Turning public links off does not delete anything: every
 * public link lookup checks the switch, so existing links stop at once and
 * come back if it is turned on again.
 */

const SharingPolicySchema = z
  .object({
    allow_public_links: z.boolean().optional(),
    allow_confluence_publishing: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'No policy field given');

const policyColumns = {
  allow_public_links: organizations.allow_public_links,
  allow_confluence_publishing: organizations.allow_confluence_publishing,
};

export function createOrgSharingPolicyRouter(): Router {
  const router = Router();

  router.get('/:org_id/sharing-policy', requireOrgMembership, async (req, res) => {
    const [policy] = await db
      .select(policyColumns)
      .from(organizations)
      .where(eq(organizations.id, req.params.org_id as string))
      .limit(1);
    if (!policy) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    res.json(policy);
  });

  router.patch('/:org_id/sharing-policy', requireOrgMembership, async (req, res) => {
    const { orgMembership } = req as unknown as OrgScopedRequest;
    if (orgMembership.role !== 'owner') {
      res.status(403).json({ error: 'Only the team owner can change sharing settings' });
      return;
    }
    const parsed = SharingPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const [policy] = await db
      .update(organizations)
      .set(parsed.data)
      .where(eq(organizations.id, req.params.org_id as string))
      .returning(policyColumns);
    if (!policy) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    res.json(policy);
  });

  return router;
}
