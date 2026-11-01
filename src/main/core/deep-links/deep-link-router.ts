import type { DeepLinkTarget } from '@shared/events/deepLinkEvents';

export interface DeepLinkRouter {
  route(target: DeepLinkTarget): void;
  /**
   * Called by the renderer once it listens for deep links: returns what
   * arrived before (a cold start, a link during boot) and from then on
   * delivers live.
   */
  claimPending(): DeepLinkTarget[];
}

/**
 * Links can arrive before the renderer is listening — at a cold start the OS
 * hands the URL over before the window has loaded. They wait here until the
 * renderer claims them, so none is emitted into a window nobody hears.
 */
export function createDeepLinkRouter(send: (target: DeepLinkTarget) => void): DeepLinkRouter {
  let claimed = false;
  const pending: DeepLinkTarget[] = [];
  return {
    route(target) {
      if (claimed) send(target);
      else pending.push(target);
    },
    claimPending() {
      claimed = true;
      return pending.splice(0);
    },
  };
}
