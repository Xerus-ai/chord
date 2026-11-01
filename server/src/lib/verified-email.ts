import { WorkOS } from '@workos-inc/node';

/**
 * Resolves the caller's real email from WorkOS by the verified token subject.
 * Returns null when no server WorkOS API key is configured (local dev /
 * DEV_MODE), which makes callers fail closed rather than trust a
 * client-supplied identity. A WorkOS lookup error propagates (fail-fast 500):
 * a real deploy has the key and WorkOS reachable, and a transient failure is
 * safe to retry.
 *
 * This is the load-bearing identity check for anything matched by email —
 * invite acceptance in particular — so it must never read an email off the
 * request body.
 */
export async function resolveVerifiedEmail(userId: string): Promise<string | null> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) return null;
  const workosUser = await new WorkOS(apiKey).userManagement.getUser(userId);
  return workosUser.email ?? null;
}
