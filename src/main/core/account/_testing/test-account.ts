import { KV } from '@main/db/kv';
import type { CachedProfile } from '../services/chord-account-service';
import { accountCredentialStore } from '../services/credential-store';

/**
 * A signed-in Chord account for main-process suites that save rows attributed
 * to the user (versions, comments), driven through the real account path: the
 * profile is written to the real `kv` table and the session token goes through
 * the real credential store into `app_secrets`. The suite must replace
 * `electron` with `electronWithTestKeychain()` (`test-keychain.ts`) so the
 * credential store has a keychain to seal the token with.
 *
 * Lives under `_testing/` because vitest excludes `**\/_*\/**` from its test
 * globs, so the file is a helper and never a suite.
 */

/** A structurally valid access token that stays valid for an hour. */
function unexpiredAccessToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  return `test.${payload}.signature`;
}

/**
 * Must run before anything in the suite reads the session: the account
 * service loads the stored credentials once per process and keeps them.
 */
export async function signInTestAccount(user: { username: string; email: string }): Promise<void> {
  const profile: CachedProfile = {
    hasAccount: true,
    userId: `user-${user.username}`,
    username: user.username,
    avatarUrl: '',
    email: user.email,
    orgId: null,
    lastValidated: new Date().toISOString(),
  };
  await new KV<{ profile: CachedProfile }>('account').set('profile', profile);
  await accountCredentialStore.set(unexpiredAccessToken());
}
