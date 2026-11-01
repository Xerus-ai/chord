import { describe, expect, it } from 'vitest';
import {
  sharingAvailability,
  toLocalAuthor,
  type SharingAvailabilityInput,
} from './sharing-availability';

const ME = {
  user_id: 'user_01ME',
  email: 'hey@example.com',
  name: 'Hey Headth',
  avatar_url: 'https://avatars.test/hey.png',
};

function input(overrides: Partial<SharingAvailabilityInput> = {}): SharingAvailabilityInput {
  return {
    authState: 'signed_in',
    ownedByAnotherAccount: false,
    synced: true,
    isOwner: true,
    localAuthor: ME,
    ...overrides,
  };
}

/**
 * Whether Share and the People section work for this work item, and if not,
 * why (shared-items design §5, "Disabled states"): a raw 404 with a Retry
 * that cannot succeed is what the People section showed for an unsynced item.
 */
describe('sharingAvailability', () => {
  it('is available for the owner of a synced item, signed in', () => {
    expect(sharingAvailability(input())).toEqual({ kind: 'available' });
  });

  it('waits while the session is still being read', () => {
    expect(sharingAvailability(input({ authState: undefined }))).toMatchObject({
      kind: 'checking',
    });
  });

  it('asks a signed-out user, or one whose session expired, to sign in', () => {
    for (const authState of ['signed_out', 'reauth_required'] as const) {
      expect(sharingAvailability(input({ authState }))).toEqual({
        kind: 'signed_out',
        reason: 'Sign in to share',
        people: 'Sign in to share',
      });
    }
  });

  it('says an item another account owns is not synced', () => {
    expect(sharingAvailability(input({ ownedByAnotherAccount: true, synced: false }))).toEqual({
      kind: 'another_account',
      reason: 'This work item belongs to another account',
      people: 'Not synced · belongs to another account',
    });
  });

  // devstation-ny7: People read "Syncing…" with no one in it until the cloud
  // create landed. The author is the signed-in account, known at create, so
  // the section lists them at once; only Share waits for the sync.
  it('says an item whose create is still queued is syncing, and lists its local author', () => {
    expect(sharingAvailability(input({ synced: false }))).toEqual({
      kind: 'syncing',
      reason: 'Available once synced',
      people: null,
      author: { ...ME, role: 'author' },
    });
  });

  it('refuses a signed-in session with no account to name as the author', () => {
    expect(() => sharingAvailability(input({ synced: false, localAuthor: null }))).toThrow();
  });

  it("tells a teammate only the owner shares, and still shows them who's on it", () => {
    expect(sharingAvailability(input({ isOwner: false }))).toEqual({
      kind: 'not_owner',
      reason: 'Only the owner manages who this work item is shared with',
      people: null,
    });
  });

  it('puts signing in before every other reason', () => {
    expect(
      sharingAvailability(
        input({ authState: 'signed_out', ownedByAnotherAccount: true, synced: false })
      ).kind
    ).toBe('signed_out');
  });
});

/** The signed-in account (`rpc.account.getSession()`) as a People row's person. */
describe('toLocalAuthor', () => {
  it("names the account by its profile's name, email and avatar", () => {
    expect(
      toLocalAuthor({
        userId: 'user_01ME',
        username: 'Hey Headth',
        avatarUrl: 'https://avatars.test/hey.png',
        email: 'hey@example.com',
        orgId: null,
      })
    ).toEqual(ME);
  });

  // The profile stores "no avatar" as '' (chord-account-service.ts signIn);
  // a row given '' would render a broken image rather than the initial.
  it('has no avatar when the profile stores none', () => {
    expect(
      toLocalAuthor({
        userId: 'user_01ME',
        username: 'Hey Headth',
        avatarUrl: '',
        email: 'hey@example.com',
        orgId: null,
      }).avatar_url
    ).toBeNull();
  });
});
