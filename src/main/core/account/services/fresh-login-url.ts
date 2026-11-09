import { clipboard } from 'electron';
import { log } from '@main/lib/logger';

/**
 * CHORD_FORCE_FRESH_LOGIN, a dev affordance for multi-account testing. The
 * default browser's live AuthKit session silently re-authenticates the
 * existing account (its session is reused even with max_age=0), so instead of
 * opening the session-tainted default browser, the URL goes on the clipboard
 * for the developer to paste into a private/incognito window. max_age=0 is
 * kept as documented belt-and-braces (the SDK has no typed option for it).
 *
 * Since Electron 44 `clipboard.writeText` is a Promise: the copy resolves once
 * the URL is on the clipboard, and a refused write rejects it.
 */
export async function copyFreshLoginUrl(authorizationUrl: string): Promise<void> {
  await clipboard.writeText(`${authorizationUrl}&max_age=0`);
  log.info(
    '[auth] CHORD_FORCE_FRESH_LOGIN — authorization URL copied to clipboard; ' +
      'paste it into a private/incognito window to sign in with a different account.'
  );
}
