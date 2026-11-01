import type { DeepLinkTarget } from '@shared/events/deepLinkEvents';
import { navigationForDeepLink, type OpenTargetNavigation } from './deep-link-navigation';

/**
 * The navigations for the links main queued before the renderer was ready
 * (`claimed`) and the live links that arrived while that claim was in flight.
 * Every queued link is older than every live one, so live links go last and
 * the most recent link the user clicked is the view they end on.
 */
export function orderDeepLinkNavigations(input: {
  claimed: DeepLinkTarget[];
  liveDuringClaim: DeepLinkTarget[];
}): OpenTargetNavigation[] {
  return [...input.claimed, ...input.liveDuringClaim].map(navigationForDeepLink);
}
