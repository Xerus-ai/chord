import { defineEvent } from '@shared/ipc/events';

/**
 * Session health, distinct from `isSignedIn`:
 * - 'signed_out' — no usable stored credentials.
 * - 'signed_in' — credentials present and not known-dead.
 * - 'reauth_required' — credentials present but the access token is dead and
 *   the refresh token was rejected (single-use tokens invalidate on reuse) —
 *   every cloud call will fail until the user signs in again.
 */
export type AuthState = 'signed_out' | 'signed_in' | 'reauth_required';

/** Fired on every authState transition so the renderer reacts the moment a
 *  background refresh fails, not on its next poll. */
export const accountStateChangedChannel = defineEvent<{ authState: AuthState }>(
  'account:state-changed'
);
