import { deepLinkOpenChannel } from '@shared/events/deepLinkEvents';
import { handleProtocolUrl } from '@main/core/account/services/workos-auth-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { createDeepLinkRouter } from './deep-link-router';
import { InvalidDeepLinkError, isOpenDeepLink, parseOpenDeepLink } from './parse-deep-link';

export const deepLinkRouter = createDeepLinkRouter((target) =>
  events.emit(deepLinkOpenChannel, target)
);

/**
 * Every `chord://` URL the OS hands the app — second instance, macOS
 * `open-url`, or the argv of a cold start — comes through here. Open links go
 * to the renderer; everything else stays with the auth callback handler. A
 * malformed open link is refused and logged as an error: it came from outside
 * the app, so there is no caller to throw to.
 */
export function openProtocolUrl(url: string): void {
  if (!isOpenDeepLink(url)) {
    handleProtocolUrl(url);
    return;
  }
  try {
    deepLinkRouter.route(parseOpenDeepLink(url));
  } catch (error) {
    if (error instanceof InvalidDeepLinkError) {
      log.error('deep-links: refused link', { error: error.message });
      return;
    }
    throw error;
  }
}
