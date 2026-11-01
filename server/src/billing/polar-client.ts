import { Polar } from '@polar-sh/sdk';

// Chord team pricing: `free` is the default state of every org (no Polar
// object exists for it), `pro` is the only self-serve purchasable plan, and
// `custom` is assigned manually for larger teams. Seat ceilings live on the
// org row (organizations.seat_limit) so a custom org can get any limit
// without a code change; these are only the defaults written by the webhook
// transitions.
export const FREE_PLAN_SEAT_LIMIT = 5;

export function proPlanSeatLimit(): number {
  const raw = process.env.POLAR_PRO_SEAT_LIMIT;
  if (!raw) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`POLAR_PRO_SEAT_LIMIT must be a positive integer, got: '${raw}'`);
  }
  return parsed;
}

export function hasPolar(): boolean {
  return !!process.env.POLAR_ACCESS_TOKEN;
}

let polarClient: Polar | null = null;

export function getPolarClient(): Polar {
  if (!polarClient) {
    const accessToken = process.env.POLAR_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('POLAR_ACCESS_TOKEN is not configured');
    }
    polarClient = new Polar({
      accessToken,
      server: process.env.POLAR_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
    });
  }
  return polarClient;
}

// Product ids come from env, not code: Chord uses its own Polar organization
// (NEVER Xerus's — its /subscription/sync path matches customers by bare
// email, so sharing an org cross-contaminates subscriptions between apps),
// and env-var ids let a new tier or price change ship without a deploy.
function proProductId(interval: 'monthly' | 'annual'): string {
  const envKey = interval === 'annual' ? 'POLAR_PRODUCT_PRO_ANNUAL' : 'POLAR_PRODUCT_PRO_MONTHLY';
  const productId = process.env[envKey];
  if (!productId) {
    throw new Error(`${envKey} is not configured`);
  }
  return productId;
}

// metadata carries {org_id, user_id} through checkout onto the subscription —
// it is the ONLY way a webhook maps a Polar event back to a Chord org.
//
// The Pro product uses Polar's native seat-based pricing (beta; SDK >= 0.48):
// `seats` is the purchased seat count and Polar prices the checkout from the
// product's tiers. Polar only enforces its own 1000-seat cap, so the Pro
// ceiling (proPlanSeatLimit) is enforced by the caller before this runs.
export async function createProCheckoutSession(params: {
  orgId: string;
  userId: string;
  interval: 'monthly' | 'annual';
  seats: number;
  customerEmail?: string;
}): Promise<{ id: string; url: string }> {
  const checkout = await getPolarClient().checkouts.create({
    products: [proProductId(params.interval)],
    seats: params.seats,
    ...(params.customerEmail ? { customerEmail: params.customerEmail } : {}),
    metadata: { org_id: params.orgId, user_id: params.userId },
  });
  return { id: checkout.id, url: checkout.url };
}

export async function getCustomerPortalUrl(customerId: string): Promise<string> {
  const session = await getPolarClient().customerSessions.create({
    customerId,
  });
  return session.customerPortalUrl;
}
