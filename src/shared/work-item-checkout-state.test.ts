/**
 * Until provisioning lands, a work item's primary lane has a planned branch
 * and no checkout. The sidebar said "Workspace setup failed" for a checkout
 * that could not be created — "setup" is the repository's setup script, which
 * never ran — and the rail listed the planned branch like any lane
 * (devstation-dd6x). Both now say what happened to the checkout.
 */
import { describe, expect, it } from 'vitest';
import { checkoutStateOf, describeCheckoutState } from './work-item-checkout-state';

describe('checkoutStateOf', () => {
  it('reads provisioning as creating, failed as failed, and ready as no state to show', () => {
    expect(checkoutStateOf('provisioning')).toBe('creating');
    expect(checkoutStateOf('failed')).toBe('failed');
    expect(checkoutStateOf('ready')).toBeNull();
  });

  it('throws on a status it does not know', () => {
    expect(() => checkoutStateOf('pending')).toThrow(/pending/);
  });
});

describe('describeCheckoutState', () => {
  it('names the checkout, never setup', () => {
    for (const state of ['creating', 'failed'] as const) {
      const { rowText, badge } = describeCheckoutState(state);
      expect(rowText.toLowerCase()).toContain('checkout');
      expect(rowText.toLowerCase()).not.toContain('setup');
      expect(badge.toLowerCase()).not.toContain('setup');
    }
  });

  it('says a failed checkout was not created', () => {
    expect(describeCheckoutState('failed')).toEqual({
      rowText: 'Checkout not created',
      badge: 'not created',
    });
    expect(describeCheckoutState('creating')).toEqual({
      rowText: 'Creating the checkout…',
      badge: 'creating',
    });
  });
});
