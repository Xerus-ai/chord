import { describe, expect, it } from 'vitest';
import { validateCreateWorkItemRequest } from './create-work-item-request';

/**
 * The shape checks on a create request that picks a branch from a remote
 * (plan §Phase 3 slice 2): it names the local branch to check out and the
 * remote branch that branch tracks. The payload crosses IPC, so each part is
 * checked before git sees it.
 */

const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('validateCreateWorkItemRequest with a remote branch', () => {
  it('accepts a remote branch checked out as a local branch', () => {
    expect(
      validateCreateWorkItemRequest({
        id: ID,
        name: 'upstream/shared',
        existingBranch: 'upstream/shared',
        trackRemoteBranch: { remote: 'upstream', branch: 'shared' },
      })
    ).toEqual({ success: true, data: undefined });
  });

  it('refuses a remote branch with no local branch to check it out as', () => {
    const result = validateCreateWorkItemRequest({
      id: ID,
      name: 'shared',
      trackRemoteBranch: { remote: 'upstream', branch: 'shared' },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('invalid_request');
  });

  it('refuses a remote branch together with a pull request', () => {
    const result = validateCreateWorkItemRequest({
      id: ID,
      name: 'shared',
      existingBranch: 'shared',
      trackRemoteBranch: { remote: 'upstream', branch: 'shared' },
      pullRequest: {
        number: 4,
        headRef: 'shared',
        headOwner: 'alice',
        headCloneUrl: null,
        maintainerCanModify: false,
        baseRemote: 'upstream',
      },
    });

    expect(result.success).toBe(false);
  });

  it('refuses a remote or branch git would read as an option, or a blank one', () => {
    for (const trackRemoteBranch of [
      { remote: '-upload-pack=evil', branch: 'shared' },
      { remote: 'upstream', branch: '--force' },
      { remote: ' ', branch: 'shared' },
      { remote: 'upstream', branch: '' },
    ]) {
      const result = validateCreateWorkItemRequest({
        id: ID,
        name: 'shared',
        existingBranch: 'shared',
        trackRemoteBranch,
      });
      expect(result.success, JSON.stringify(trackRemoteBranch)).toBe(false);
    }
  });
});

/**
 * A pull request is fetched from the remote that is its repository
 * (devstation-uoe): the request names that remote, and one that doesn't is
 * refused — never fetched from whichever remote is preferred.
 */
describe('validateCreateWorkItemRequest with a pull request', () => {
  const pullRequest = {
    number: 4,
    headRef: 'fix-typo',
    headOwner: 'alice',
    headCloneUrl: null,
    maintainerCanModify: false,
    baseRemote: 'upstream',
  };

  it("accepts a pull request fetched from its repository's remote", () => {
    expect(
      validateCreateWorkItemRequest({
        id: ID,
        name: '#4 Fix the typo',
        existingBranch: 'fix-typo',
        pullRequest,
      })
    ).toEqual({ success: true, data: undefined });
  });

  it('refuses a pull request that names no remote to fetch it from', () => {
    const { baseRemote: _omitted, ...withoutRemote } = pullRequest;
    const result = validateCreateWorkItemRequest({
      id: ID,
      name: '#4 Fix the typo',
      existingBranch: 'fix-typo',
      // The wire can drop what the type requires.
      pullRequest: withoutRemote as typeof pullRequest,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('invalid_request');
    expect(result.error.message).toMatch(/remote/i);
  });
});
