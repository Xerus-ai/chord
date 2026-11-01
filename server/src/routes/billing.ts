import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import {
  createProCheckoutSession,
  getCustomerPortalUrl,
  hasPolar,
  proPlanSeatLimit,
} from '../billing/polar-client.js';
import { db, hasDb } from '../db/client.js';
import { organizations, users } from '../db/schema.js';
import { countSeatsUsed } from '../lib/org-seats.js';
import { requireOrgMembership, type OrgScopedRequest } from '../middleware/access-control.js';
import { type AuthenticatedRequest } from '../middleware/auth.js';

const CheckoutSchema = z.object({
  interval: z.enum(['monthly', 'annual']).default('monthly'),
  seats: z.number().int().min(1),
});

function isBillingAdmin(role: string): boolean {
  return role === 'admin' || role === 'owner';
}

export function createBillingRouter(): Router {
  const router = Router();

  router.use((_req, res, next) => {
    if (!hasDb) {
      res.status(503).json({ error: 'Billing requires a database' });
      return;
    }
    next();
  });

  // Plan and seat state for the org — readable by every member so the app
  // can render seat counts and upgrade prompts without an admin session.
  router.get('/:org_id/subscription', requireOrgMembership, async (req, res) => {
    const org_id = req.params.org_id as string;

    const [org] = await db
      .select({
        plan: organizations.plan,
        seat_limit: organizations.seat_limit,
        subscription_status: organizations.subscription_status,
        current_period_end: organizations.current_period_end,
        polar_customer_id: organizations.polar_customer_id,
      })
      .from(organizations)
      .where(eq(organizations.id, org_id))
      .limit(1);

    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    res.json({
      plan: org.plan,
      seat_limit: org.seat_limit,
      seats_used: await countSeatsUsed(org_id),
      subscription_status: org.subscription_status,
      current_period_end: org.current_period_end?.toISOString() ?? null,
      has_billing_account: !!org.polar_customer_id,
    });
  });

  // Starts a Pro checkout. The caller opens the returned URL in the system
  // browser; activation lands via the Polar webhook, so the desktop app just
  // polls /subscription afterwards — no successUrl round-trip needed.
  router.post('/:org_id/checkout', requireOrgMembership, async (req, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const { orgMembership } = req as unknown as OrgScopedRequest;
    const org_id = req.params.org_id as string;

    if (!isBillingAdmin(orgMembership.role)) {
      res.status(403).json({ error: 'Only admins can manage billing' });
      return;
    }

    if (!hasPolar()) {
      res.status(503).json({ error: 'Billing is not configured on this server' });
      return;
    }

    const parsed = CheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const proSeatLimit = proPlanSeatLimit();
    if (parsed.data.seats > proSeatLimit) {
      res.status(400).json({
        error: `The pro plan supports up to ${proSeatLimit} seats. Contact us for a custom plan.`,
        code: 'PRO_SEAT_LIMIT_EXCEEDED',
        max_seats: proSeatLimit,
      });
      return;
    }

    // Buying fewer seats than the team already occupies would put the org
    // over its new limit on day one.
    const seatsUsed = await countSeatsUsed(org_id);
    if (parsed.data.seats < seatsUsed) {
      res.status(400).json({
        error: `Your team already uses ${seatsUsed} seats — choose at least that many.`,
        code: 'SEATS_BELOW_USAGE',
        seats_used: seatsUsed,
      });
      return;
    }

    const [billingUser] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, user.userId))
      .limit(1);

    const checkout = await createProCheckoutSession({
      orgId: org_id,
      userId: user.userId,
      interval: parsed.data.interval,
      seats: parsed.data.seats,
      customerEmail: billingUser?.email ?? undefined,
    });

    res.status(201).json({ checkout_id: checkout.id, url: checkout.url });
  });

  // Polar-hosted portal for invoices, payment method, and cancellation.
  router.get('/:org_id/portal', requireOrgMembership, async (req, res) => {
    const { orgMembership } = req as unknown as OrgScopedRequest;
    const org_id = req.params.org_id as string;

    if (!isBillingAdmin(orgMembership.role)) {
      res.status(403).json({ error: 'Only admins can manage billing' });
      return;
    }

    const [org] = await db
      .select({ polar_customer_id: organizations.polar_customer_id })
      .from(organizations)
      .where(eq(organizations.id, org_id))
      .limit(1);

    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    if (!org.polar_customer_id) {
      res.status(400).json({
        error: 'This team has no billing account yet — subscribe first.',
        code: 'NO_BILLING_ACCOUNT',
      });
      return;
    }

    res.json({ url: await getCustomerPortalUrl(org.polar_customer_id) });
  });

  return router;
}
