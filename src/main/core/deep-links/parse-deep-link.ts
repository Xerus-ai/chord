import type { DeepLinkTarget } from '@shared/events/deepLinkEvents';

/**
 * `chord://open/…` links handed to the app by the OS (design 2026-09-24 §5):
 *
 *   chord://open/work-item/<id>
 *   chord://open/artifact/<id>
 *   chord://open/p/<token>
 *
 * Parsed strictly against the raw string: one of the three forms, an id or
 * token of URL-safe characters, at most one trailing slash (some browsers add
 * it), and no query or fragment. Anything else is refused with an error that
 * names the link — never guessed at, never half-opened.
 */

export class InvalidDeepLinkError extends Error {
  constructor(url: string, reason: string) {
    super(`Refused deep link ${url}: ${reason}`);
    this.name = 'InvalidDeepLinkError';
  }
}

const OPEN_LINK = /^chord:\/\/open\/(work-item|artifact|p)\/([^/?#]*)\/?$/;
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Link tokens are base64url HMACs (43 characters); the bounds only refuse junk. */
const LINK_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** Whether `token` can be a public-link token — checked before it goes into any URL. */
export function isPublicLinkToken(token: string): boolean {
  return LINK_TOKEN.test(token);
}

export function parseOpenDeepLink(url: string): DeepLinkTarget {
  const match = OPEN_LINK.exec(url);
  if (!match) {
    throw new InvalidDeepLinkError(
      url,
      'expected chord://open/work-item/<id>, chord://open/artifact/<id> or chord://open/p/<token>'
    );
  }
  const [, kind, value = ''] = match;
  if (kind === 'p') {
    if (!isPublicLinkToken(value)) throw new InvalidDeepLinkError(url, 'malformed link token');
    return { kind: 'public-link', token: value };
  }
  if (!RESOURCE_ID.test(value)) throw new InvalidDeepLinkError(url, `malformed ${kind} id`);
  return kind === 'work-item'
    ? { kind: 'work-item', workItemId: value }
    : { kind: 'artifact', artifactId: value };
}

/** Whether a `chord://` URL is meant for the open handler rather than, say, the auth callback. */
export function isOpenDeepLink(url: string): boolean {
  return url.startsWith('chord://open/');
}

/** The `chord://` URL a cold start or a second instance was launched with (Windows, Linux). */
export function findProtocolUrlInArgv(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.startsWith('chord://')) ?? null;
}
