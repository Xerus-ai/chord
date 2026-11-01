import { rpc } from '@renderer/lib/ipc';

/**
 * Async token getter handed to HocuspocusProvider. The provider calls it on
 * every (re)authentication, and the main process refreshes the session token
 * when it is near expiry, so a long-lived editing session never reuses a
 * stale token.
 */
export async function fetchCollabToken(): Promise<string> {
  const token = await rpc.account.getAccessToken();
  if (!token) throw new Error('Not signed in');
  return token;
}
