/**
 * What a work item's checkout is while provisioning — creating the branch and
 * its checkout — has not made it. "Setup" is the repository's setup script,
 * which runs only in a checkout that exists, so a failure here is never a
 * setup failure (devstation-dd6x). The sidebar row and the rail's lane row
 * read from this one place.
 */
export type CheckoutState = 'creating' | 'failed';

/** `work_items.provision_status` as a checkout state; null once the checkout exists. */
export function checkoutStateOf(provisionStatus: string): CheckoutState | null {
  switch (provisionStatus) {
    case 'provisioning':
      return 'creating';
    case 'failed':
      return 'failed';
    case 'ready':
      return null;
    default:
      throw new Error(`Unknown work item provision status: ${provisionStatus}`);
  }
}

/** The sidebar row's line and the rail lane row's badge for a checkout state. */
export function describeCheckoutState(state: CheckoutState): { rowText: string; badge: string } {
  return state === 'creating'
    ? { rowText: 'Creating the checkout…', badge: 'creating' }
    : { rowText: 'Checkout not created', badge: 'not created' };
}
