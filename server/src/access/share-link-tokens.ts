import { createHash, createHmac } from 'node:crypto';

/**
 * Public link tokens. The token is HMAC-SHA256(SHARE_LINK_SECRET, link id),
 * base64url — derivable again by the server, so the author can copy a live
 * link at any time, while the database holds only sha256(token). A database
 * leak alone therefore reveals no link; rotating the secret invalidates all
 * of them. Both env vars are read on use and fail fast when missing.
 */

function requireEnv(name: 'SHARE_LINK_SECRET' | 'SYNC_SERVER_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`[share-links] ${name} is not configured`);
  return value;
}

export function deriveShareLinkToken(linkId: string): string {
  return createHmac('sha256', requireEnv('SHARE_LINK_SECRET')).update(linkId).digest('base64url');
}

export function hashShareLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The public URL of a live link: `${SYNC_SERVER_URL}/p/<token>`. */
export function buildShareLinkUrl(linkId: string): string {
  const origin = requireEnv('SYNC_SERVER_URL').replace(/\/+$/, '');
  return `${origin}/p/${deriveShareLinkToken(linkId)}`;
}

/** Fails startup when public links cannot be issued or verified. */
export function assertShareLinksConfigured(): void {
  requireEnv('SHARE_LINK_SECRET');
  requireEnv('SYNC_SERVER_URL');
}
