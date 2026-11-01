import type { AuthState } from '@shared/events/accountEvents';
import type { AccountUser } from '@main/core/account/services/chord-account-service';
import type { Participant, SharingPerson } from './sharing-api';

export interface SharingAvailabilityInput {
  /** undefined while the session is still being read. */
  authState: AuthState | undefined;
  /** A local row another account owns: it is not synced for this one. */
  ownedByAnotherAccount: boolean;
  /** The cloud has the item (a teammate's always is; a local one once its create landed). */
  synced: boolean;
  /** Only the owner shares (shared-items design §10). */
  isOwner: boolean;
  /**
   * The signed-in account (`rpc.account.getSession()`, via `toLocalAuthor`),
   * the author of every item created on this machine. Null while no one is
   * signed in.
   */
  localAuthor: SharingPerson | null;
}

export type SharingAvailability =
  | { kind: 'available' }
  | {
      kind: 'checking' | 'signed_out' | 'another_account' | 'not_owner';
      /** Why Share is unavailable, for its tooltip. */
      reason: string;
      /** What the People section says instead of a roster; null when it shows the roster. */
      people: string | null;
    }
  | {
      /** The item's create is still queued: the cloud has no roster for it yet. */
      kind: 'syncing';
      reason: string;
      people: null;
      /** Who the People section lists meanwhile: the author, known locally. */
      author: Participant;
    };

/** The signed-in account as a person in a People row. */
export function toLocalAuthor(user: AccountUser): SharingPerson {
  return {
    user_id: user.userId,
    email: user.email,
    name: user.username,
    // The profile stores "no avatar" as '' (chord-account-service.ts signIn).
    avatar_url: user.avatarUrl === '' ? null : user.avatarUrl,
  };
}

/**
 * Whether Share and the People section work for a work item, and if not, why
 * (shared-items design §5, "Disabled states"). Every Share entry point and
 * the People section read this one answer.
 */
export function sharingAvailability(input: SharingAvailabilityInput): SharingAvailability {
  if (input.authState === undefined) {
    return { kind: 'checking', reason: 'Checking your session…', people: 'Loading…' };
  }
  if (input.authState !== 'signed_in') {
    return { kind: 'signed_out', reason: 'Sign in to share', people: 'Sign in to share' };
  }
  if (input.ownedByAnotherAccount) {
    return {
      kind: 'another_account',
      reason: 'This work item belongs to another account',
      people: 'Not synced · belongs to another account',
    };
  }
  if (!input.isOwner) {
    return {
      kind: 'not_owner',
      reason: 'Only the owner manages who this work item is shared with',
      people: null,
    };
  }
  if (!input.synced) {
    // The author is known the moment the item is created; only Share waits
    // for the cloud (devstation-ny7). A signed-in session always has its user.
    if (input.localAuthor === null) {
      throw new Error('A signed-in session has no account to name as the author');
    }
    return {
      kind: 'syncing',
      reason: 'Available once synced',
      people: null,
      author: { ...input.localAuthor, role: 'author' },
    };
  }
  return { kind: 'available' };
}
