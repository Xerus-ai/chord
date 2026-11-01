import { eq, sql, type SQL } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import { db } from '../db/client.js';
import { polarWebhookEvents } from '../db/schema-platform.js';
import { organizations } from '../db/schema.js';
import { FREE_PLAN_SEAT_LIMIT, proPlanSeatLimit } from './polar-client.js';

// Subscription lifecycle only: Chord has no one-time purchases, so checkout
// events carry nothing the subscription events don't. Unknown types are
// acknowledged with 200 and ignored — returning an error would make Polar
// retry an event we will never handle.
const HANDLED_EVENT_TYPES = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
  'subscription.revoked',
]);

// When express.raw() is mounted on the webhook path (and mounted BEFORE the
// global express.json — see server.ts), req.body is a Buffer. The other
// shapes defend against a parser-ordering regression rather than silently
// failing signature verification.
function extractRawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf-8');
  }
  if (typeof req.body === 'string') {
    return req.body;
  }
  if (typeof req.body === 'object' && req.body !== null) {
    return JSON.stringify(req.body);
  }
  throw new Error('Unable to extract raw body from Polar webhook request');
}

function verifySignature(rawBody: string, req: Request, secret: string): Record<string, unknown> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value;
  }
  // standardwebhooks expects a base64 secret; Polar stores it as plain UTF-8
  // (same re-encode @polar-sh/sdk/webhooks does internally). Skipping this
  // makes every verification fail with a signature mismatch.
  const webhook = new Webhook(Buffer.from(secret, 'utf-8').toString('base64'));
  return webhook.verify(rawBody, headers) as Record<string, unknown>;
}

export interface SubscriptionEventData {
  orgId: string;
  subscriptionId: string | null;
  customerId: string | null;
  status: string | null;
  currentPeriodEnd: Date | null;
  seats: number | null;
}

// Raw Polar webhook payloads are snake_case JSON (they do not pass through
// the SDK's camelCase mapping). org_id comes from the checkout metadata that
// createProCheckoutSession attached — it is the only link back to a Chord org.
function extractSubscriptionData(payload: Record<string, unknown>): SubscriptionEventData | null {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const orgId = typeof metadata.org_id === 'string' ? metadata.org_id : null;
  if (!orgId) return null;

  const periodEndRaw = data.current_period_end;
  return {
    orgId,
    subscriptionId: typeof data.id === 'string' ? data.id : null,
    customerId: typeof data.customer_id === 'string' ? data.customer_id : null,
    status: typeof data.status === 'string' ? data.status : null,
    currentPeriodEnd: typeof periodEndRaw === 'string' ? new Date(periodEndRaw) : null,
    seats: typeof data.seats === 'number' ? data.seats : null,
  };
}

// The subscription object's own modification time — the monotonic field the
// ordering guard compares. The webhook-timestamp HEADER is useless for this:
// it stamps the delivery ATTEMPT, so a retried old event carries a newer
// timestamp than the fresh event it would overwrite.
export function extractEventModifiedAt(payload: Record<string, unknown>): Date | null {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const raw = data.modified_at ?? data.created_at;
  if (typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The idempotency key. Polar's `webhook-id` header is stable across every
 * delivery attempt of one event, so two deliveries of the same event resolve
 * to the same key and the second finds the first already recorded. The payload
 * id is the fallback for a delivery that somehow arrives without the header.
 */
export function resolveEventId(
  headers: Record<string, unknown>,
  payload: Record<string, unknown>
): string | null {
  const raw = headers['webhook-id'] ?? payload.id;
  return typeof raw === 'string' && raw ? raw : null;
}

/**
 * subscription.revoked is TERMINAL: it is the only transition that returns an
 * org to the free plan and the free seat limit, and Polar sends nothing more
 * for a dead subscription. A revoke that the ordering guard discards is never
 * redelivered and never corrected by a later event, so the org would keep paid
 * entitlements forever without paying. Revocation therefore always applies.
 */
export function isTerminalEvent(eventType: string): boolean {
  return eventType === 'subscription.revoked';
}

/**
 * Ordering guard (pure decision): per-event-id idempotency alone lets an
 * out-of-order retry of an OLDER event overwrite newer subscription state
 * (e.g. a delayed subscription.updated landing after subscription.canceled).
 *
 * `highWaterMark` is the newest modification time already recorded FOR THE
 * SAME SUBSCRIPTION. Scoping matters: one org can hold several subscriptions
 * over its lifetime (cancel-at-period-end followed immediately by a fresh
 * re-subscribe), and an org-wide comparison makes those two timelines
 * suppress each other's legitimate events.
 */
export function shouldSkipStaleEvent(
  eventType: string,
  incoming: Date | null,
  highWaterMark: Date | null
): boolean {
  if (isTerminalEvent(eventType)) return false;
  if (!incoming || !highWaterMark) return false;
  return highWaterMark.getTime() > incoming.getTime();
}

/**
 * Restricts recorded events to ONE subscription, matching on the id inside the
 * stored payload. This is what keeps two subscriptions of the same org off each
 * other's timeline. The id is bound as a parameter, never concatenated.
 */
export function buildSubscriptionScopeFilter(subscriptionId: string): SQL {
  return sql`${polarWebhookEvents.payload} -> 'data' ->> 'id' = ${subscriptionId}`;
}

// Newest-first on the subscription object's own RFC3339 timestamp, whose
// lexicographic order is its chronological order.
const NEWEST_RECORDED_FIRST = sql`COALESCE(${polarWebhookEvents.payload} -> 'data' ->> 'modified_at', ${polarWebhookEvents.payload} -> 'data' ->> 'created_at') DESC NULLS LAST`;

/**
 * Newest recorded event for one subscription. Scoped by the filter above and
 * capped at a single row, so the cost stays flat instead of growing with the
 * org's whole webhook history the way the org-wide scan did. The row that
 * comes back is re-read through extractEventModifiedAt so recorded and
 * incoming events share exactly one timestamp-parsing path.
 */
async function findSubscriptionHighWaterMark(subscriptionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ payload: polarWebhookEvents.payload })
    .from(polarWebhookEvents)
    .where(buildSubscriptionScopeFilter(subscriptionId))
    .orderBy(NEWEST_RECORDED_FIRST)
    .limit(1);
  if (!row) return null;
  return extractEventModifiedAt((row.payload ?? {}) as Record<string, unknown>);
}

/**
 * Query half of the ordering guard. The short-circuits skip the round trip for
 * inputs shouldSkipStaleEvent could never suppress anyway: a terminal event, a
 * payload with no readable timestamp, or one carrying no subscription id to
 * scope the lookup by.
 */
async function isStaleEvent(
  eventType: string,
  subscriptionId: string | null,
  incoming: Date | null
): Promise<boolean> {
  if (isTerminalEvent(eventType) || !incoming || !subscriptionId) return false;
  const highWaterMark = await findSubscriptionHighWaterMark(subscriptionId);
  return shouldSkipStaleEvent(eventType, incoming, highWaterMark);
}

// Polar's subscription statuses collapse onto the org row's vocabulary.
function mapSubscriptionStatus(polarStatus: string | null): string {
  switch (polarStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return polarStatus ?? 'unknown';
  }
}

export interface OrganizationBillingUpdate {
  plan?: string;
  seat_limit?: number;
  polar_customer_id?: string | null;
  polar_subscription_id?: string | null;
  subscription_status: string;
  current_period_end: Date | null;
}

/** The absolute column set an event writes onto the org row. Pure. */
export function buildOrganizationBillingUpdate(
  eventType: string,
  data: SubscriptionEventData
): OrganizationBillingUpdate {
  if (isTerminalEvent(eventType)) {
    // Access is gone NOW (payment failure exhausted retries, or immediate
    // cancellation). Back to free-plan ceilings; members over the free limit
    // keep their membership — enforcement only gates NEW invites.
    return {
      plan: 'free',
      seat_limit: FREE_PLAN_SEAT_LIMIT,
      subscription_status: 'revoked',
      current_period_end: data.currentPeriodEnd,
    };
  }

  if (eventType === 'subscription.canceled') {
    // Cancel-at-period-end: the team keeps pro until expiry, so plan and
    // seat_limit stay untouched; revoked (above) is what takes them away.
    return {
      subscription_status: 'canceled',
      current_period_end: data.currentPeriodEnd,
    };
  }

  // subscription.created / subscription.updated
  const status = mapSubscriptionStatus(data.status);
  return {
    polar_customer_id: data.customerId,
    polar_subscription_id: data.subscriptionId,
    subscription_status: status,
    current_period_end: data.currentPeriodEnd,
    ...(status === 'active' ? { plan: 'pro', seat_limit: data.seats ?? proPlanSeatLimit() } : {}),
  };
}

async function applySubscriptionEvent(
  eventType: string,
  data: SubscriptionEventData
): Promise<void> {
  await db
    .update(organizations)
    .set(buildOrganizationBillingUpdate(eventType, data))
    .where(eq(organizations.id, data.orgId));
}

export async function handlePolarWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('POLAR_WEBHOOK_SECRET is not configured');
  }

  const rawBody = extractRawBody(req);

  let payload: Record<string, unknown>;
  try {
    payload = verifySignature(rawBody, req, secret);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.warn('[billing] Polar webhook signature verification failed');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
    throw err;
  }

  const eventType = typeof payload.type === 'string' ? payload.type : '';
  if (!HANDLED_EVENT_TYPES.has(eventType)) {
    res.status(200).json({ received: true });
    return;
  }

  const eventId = resolveEventId(req.headers, payload);
  if (!eventId) {
    throw new Error(`Missing event id on ${eventType} webhook`);
  }

  // Idempotency without a transaction: the neon-http driver runs every
  // statement in its own implicit transaction, so check-apply-record cannot
  // be atomic. The order is deliberate: (1) skip if recorded, (2) apply the
  // state change, (3) record the event. Every apply is an ABSOLUTE column
  // set — never an increment — so a crash between (2) and (3) means the
  // redelivery re-applies identical values, which is harmless; the reverse
  // order would record an event whose state change never happened.
  const [seen] = await db
    .select({ event_id: polarWebhookEvents.event_id })
    .from(polarWebhookEvents)
    .where(eq(polarWebhookEvents.event_id, eventId))
    .limit(1);

  if (seen) {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  const data = extractSubscriptionData(payload);
  if (!data) {
    // A subscription with no org_id metadata was not created through Chord's
    // checkout (dashboard-created, or another app sharing the Polar org —
    // which must never happen). Record it so redeliveries stay quiet, but be
    // LOUD: silently dropping billing events is how plans stop activating.
    console.error(`[billing] ${eventType} event ${eventId} has no org_id metadata — skipped`);
  } else if (await isStaleEvent(eventType, data.subscriptionId, extractEventModifiedAt(payload))) {
    // Recorded (below) but never applied: a newer event already wrote this
    // subscription's state. Never reached for subscription.revoked — see
    // isTerminalEvent.
    console.warn(
      `[billing] ${eventType} event ${eventId} is older than applied state for subscription ${data.subscriptionId} — skipped`
    );
  } else {
    await applySubscriptionEvent(eventType, data);
  }

  await db
    .insert(polarWebhookEvents)
    .values({
      event_id: eventId,
      event_type: eventType,
      org_id: data?.orgId ?? null,
      payload,
    })
    .onConflictDoNothing();

  res.status(200).json({ received: true });
}
