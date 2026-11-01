import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { polarWebhookEvents } from '../db/schema-platform.js';
import { FREE_PLAN_SEAT_LIMIT } from './polar-client.js';
import {
  buildOrganizationBillingUpdate,
  buildSubscriptionScopeFilter,
  extractEventModifiedAt,
  isTerminalEvent,
  resolveEventId,
  shouldSkipStaleEvent,
  type SubscriptionEventData,
} from './polar-webhook.js';

/**
 * The webhook's ordering guard, tested through its pure decision functions —
 * the server suite has no database harness, and the parts worth pinning down
 * are decisions, not queries: which event gets suppressed, and which columns
 * an event writes.
 *
 * The guard shipped org-scoped and fail-open on revocation, which is a money
 * bug: an org whose subscription.revoked was discarded as "stale" keeps pro
 * entitlements and the pro seat limit forever, because revoke is the only
 * de-provisioning transition and Polar never redelivers it.
 */

const OLDER = new Date('2026-01-10T00:00:00.000Z');
const NEWER = new Date('2026-02-10T00:00:00.000Z');

function subscriptionData(overrides: Partial<SubscriptionEventData> = {}): SubscriptionEventData {
  return {
    orgId: 'org_1',
    subscriptionId: 'sub_a',
    customerId: 'cus_1',
    status: 'active',
    currentPeriodEnd: new Date('2026-03-10T00:00:00.000Z'),
    seats: 12,
    ...overrides,
  };
}

/** A raw Polar payload — snake_case, as delivered over the wire. */
function payload(subscriptionId: string, modifiedAt: string): Record<string, unknown> {
  return {
    type: 'subscription.updated',
    data: {
      id: subscriptionId,
      status: 'active',
      modified_at: modifiedAt,
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { org_id: 'org_1' },
    },
  };
}

describe('shouldSkipStaleEvent', () => {
  it('skips an out-of-order subscription.updated for the same subscription', () => {
    expect(shouldSkipStaleEvent('subscription.updated', OLDER, NEWER)).toBe(true);
  });

  it('applies an event newer than the recorded high-water mark', () => {
    expect(shouldSkipStaleEvent('subscription.updated', NEWER, OLDER)).toBe(false);
  });

  it('applies an event whose timestamp ties the high-water mark', () => {
    expect(shouldSkipStaleEvent('subscription.updated', OLDER, new Date(OLDER))).toBe(false);
  });

  it('applies when the subscription has no recorded history to compare against', () => {
    expect(shouldSkipStaleEvent('subscription.updated', OLDER, null)).toBe(false);
  });

  it('applies when the incoming payload carries no readable timestamp', () => {
    expect(shouldSkipStaleEvent('subscription.updated', null, NEWER)).toBe(false);
  });

  it('skips a stale subscription.canceled — cancellation is not terminal', () => {
    expect(shouldSkipStaleEvent('subscription.canceled', OLDER, NEWER)).toBe(true);
  });
});

describe('subscription.revoked is exempt from the ordering guard', () => {
  it('is recognized as the terminal event', () => {
    expect(isTerminalEvent('subscription.revoked')).toBe(true);
    expect(isTerminalEvent('subscription.updated')).toBe(false);
    expect(isTerminalEvent('subscription.canceled')).toBe(false);
    expect(isTerminalEvent('subscription.created')).toBe(false);
  });

  it('applies even when older than every recorded event, and de-provisions the org', () => {
    // The regression test for the money bug: a revoke arriving out of order
    // must still run, and running it must return the org to the free plan.
    expect(shouldSkipStaleEvent('subscription.revoked', OLDER, NEWER)).toBe(false);

    const update = buildOrganizationBillingUpdate('subscription.revoked', subscriptionData());
    expect(update.plan).toBe('free');
    expect(update.seat_limit).toBe(FREE_PLAN_SEAT_LIMIT);
    expect(update.subscription_status).toBe('revoked');
  });

  it('applies even with no timestamp at all on the payload', () => {
    expect(shouldSkipStaleEvent('subscription.revoked', null, NEWER)).toBe(false);
  });
});

describe('high-water marks are scoped to a single subscription', () => {
  it('looks up history by subscription id, so a sibling subscription cannot suppress an event', () => {
    // Both payloads belong to org_1; only their subscription ids differ, which
    // is the cancel-then-immediately-re-subscribe case. Under the old org-wide
    // lookup sub_b's newer timestamp became sub_a's high-water mark and
    // suppressed sub_a's legitimate event.
    const subA = payload('sub_a', OLDER.toISOString());
    const subB = payload('sub_b', NEWER.toISOString());
    expect((subA.data as Record<string, unknown>).metadata).toEqual(
      (subB.data as Record<string, unknown>).metadata
    );
    expect(shouldSkipStaleEvent('subscription.updated', OLDER, extractEventModifiedAt(subB))).toBe(
      true
    );

    // The lookup narrows to one subscription id, so sub_b's row is never a
    // candidate for sub_a's high-water mark in the first place.
    const query = new PgDialect().sqlToQuery(buildSubscriptionScopeFilter('sub_a'));
    expect(query.sql).toMatch(/->\s*'data'\s*->>\s*'id'\s*=\s*\$1/);
    expect(query.params).toEqual(['sub_a']);
    // Parameter binding, not interpolation — the id never reaches the SQL text.
    expect(query.sql).not.toContain('sub_a');
    expect(new PgDialect().sqlToQuery(buildSubscriptionScopeFilter('sub_b')).params).toEqual([
      'sub_b',
    ]);
  });
});

describe('per-event-id idempotency is untouched by the ordering guard', () => {
  it('resolves both deliveries of one event to the same key from the webhook-id header', () => {
    const first = resolveEventId({ 'webhook-id': 'evt_1' }, { id: 'payload_id' });
    const retry = resolveEventId(
      { 'webhook-id': 'evt_1', 'webhook-timestamp': '1770000000' },
      { id: 'payload_id' }
    );
    expect(first).toBe('evt_1');
    expect(retry).toBe(first);
  });

  it('falls back to the payload id when the header is absent', () => {
    expect(resolveEventId({}, { id: 'evt_2' })).toBe('evt_2');
  });

  it('returns null for an unusable id so the caller can fail fast', () => {
    expect(resolveEventId({}, {})).toBeNull();
    expect(resolveEventId({ 'webhook-id': '' }, {})).toBeNull();
  });

  it('keys the duplicate lookup on event_id alone — not on subscription or org', () => {
    const query = new PgDialect().sqlToQuery(eq(polarWebhookEvents.event_id, 'evt_1'));
    expect(query.sql).toMatch(/"event_id"\s*=\s*\$1/);
    expect(query.params).toEqual(['evt_1']);
  });
});

describe('extractEventModifiedAt', () => {
  it('reads the subscription-object modification time, not the delivery time', () => {
    expect(extractEventModifiedAt(payload('sub_a', NEWER.toISOString()))?.toISOString()).toBe(
      NEWER.toISOString()
    );
  });

  it('falls back to created_at when the subscription was never modified', () => {
    const raw = { data: { id: 'sub_a', created_at: OLDER.toISOString() } };
    expect(extractEventModifiedAt(raw)?.toISOString()).toBe(OLDER.toISOString());
  });

  it('returns null for a missing timestamp', () => {
    expect(extractEventModifiedAt({ data: { id: 'sub_a' } })).toBeNull();
  });

  it('returns null for an unparseable timestamp rather than an Invalid Date', () => {
    expect(extractEventModifiedAt({ data: { id: 'sub_a', modified_at: 'not-a-date' } })).toBeNull();
  });
});

describe('buildOrganizationBillingUpdate', () => {
  it('upgrades an active subscription to pro with the purchased seat count', () => {
    const update = buildOrganizationBillingUpdate('subscription.updated', subscriptionData());
    expect(update.plan).toBe('pro');
    expect(update.seat_limit).toBe(12);
    expect(update.subscription_status).toBe('active');
    expect(update.polar_subscription_id).toBe('sub_a');
  });

  it('leaves plan and seat_limit untouched for a cancel-at-period-end', () => {
    const update = buildOrganizationBillingUpdate('subscription.canceled', subscriptionData());
    expect(update.subscription_status).toBe('canceled');
    expect(update).not.toHaveProperty('plan');
    expect(update).not.toHaveProperty('seat_limit');
  });

  it('never clears plan on a past_due update — only revocation de-provisions', () => {
    const update = buildOrganizationBillingUpdate(
      'subscription.updated',
      subscriptionData({ status: 'past_due' })
    );
    expect(update.subscription_status).toBe('past_due');
    expect(update).not.toHaveProperty('plan');
  });
});
