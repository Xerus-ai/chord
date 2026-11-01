import { describe, expect, it } from 'vitest';
import {
  selectSourceControlActions,
  type SourceControlActionKind,
  type SourceControlPolicyInput,
  type SourceControlReason,
} from './policy';

const CLEAN_PUBLISHED: SourceControlPolicyInput = {
  hasCheckout: true,
  stagedCount: 0,
  unstagedCount: 0,
  conflictCount: 0,
  aheadCount: 0,
  publication: 'published',
  branchName: 'feat/rail',
  hasPullRequest: true,
  hasGitHubRemote: true,
  lanesLoaded: true,
  commitMessage: '',
  busy: false,
};

function reasonOf(
  input: SourceControlPolicyInput,
  kind: SourceControlActionKind
): SourceControlReason | null {
  const action = selectSourceControlActions(input).actions.find((a) => a.kind === kind);
  if (!action) throw new Error(`policy dropped ${kind} from the menu`);
  return action.disabledReason;
}

describe('selectSourceControlActions', () => {
  it('always lists every action so the menu shape never changes', () => {
    const shapes = [
      CLEAN_PUBLISHED,
      { ...CLEAN_PUBLISHED, hasCheckout: false },
      { ...CLEAN_PUBLISHED, conflictCount: 3 },
      { ...CLEAN_PUBLISHED, unstagedCount: 2, commitMessage: 'wip' },
    ];
    for (const input of shapes) {
      expect(selectSourceControlActions(input).actions.map((a) => a.kind)).toEqual([
        'resolve-conflicts',
        'commit',
        'publish',
        'push',
        'create-pr',
        'pull',
      ]);
    }
  });

  it('makes conflicts the primary action and blocks committing over them', () => {
    const input = { ...CLEAN_PUBLISHED, conflictCount: 2, unstagedCount: 2, commitMessage: 'fix' };
    expect(selectSourceControlActions(input).primary).toEqual({
      kind: 'resolve-conflicts',
      disabledReason: null,
    });
    expect(reasonOf(input, 'commit')).toBe('conflicts-present');
  });

  it('asks for a message before committing, and commits once it has one', () => {
    const dirty = { ...CLEAN_PUBLISHED, unstagedCount: 1 };
    expect(reasonOf(dirty, 'commit')).toBe('no-commit-message');
    expect(reasonOf({ ...dirty, commitMessage: '   ' }, 'commit')).toBe('no-commit-message');
    expect(selectSourceControlActions({ ...dirty, commitMessage: 'Add rail' }).primary.kind).toBe(
      'commit'
    );
  });

  it('publishes an unpublished branch before offering push or pull', () => {
    const unpublished = {
      ...CLEAN_PUBLISHED,
      publication: 'unpublished' as const,
      hasPullRequest: false,
    };
    expect(selectSourceControlActions(unpublished).primary.kind).toBe('publish');
    expect(reasonOf(unpublished, 'push')).toBe('not-published');
    expect(reasonOf(unpublished, 'pull')).toBe('not-published');
  });

  // Create PR publishes the lane's branch itself (create-lane-pull-request.ts),
  // so "Publish the branch first" would be a precondition that isn't one.
  it('offers Create PR on an unpublished branch, which it publishes on the way', () => {
    const unpublished = {
      ...CLEAN_PUBLISHED,
      publication: 'unpublished' as const,
      hasPullRequest: false,
    };
    expect(reasonOf(unpublished, 'create-pr')).toBeNull();
  });

  it('a detached checkout has no branch to open a pull request from', () => {
    const detached = {
      ...CLEAN_PUBLISHED,
      publication: 'detached' as const,
      branchName: null,
      hasPullRequest: false,
    };
    expect(reasonOf(detached, 'create-pr')).toBe('no-branch');
  });

  // devstation-7eq: with no remote there is nowhere to publish, push or pull,
  // and saying "Publish the branch first" sends the user to an action that fails.
  it('a repository with no remote cannot publish, push or pull, and says so', () => {
    const noRemote = {
      ...CLEAN_PUBLISHED,
      publication: 'no_remote' as const,
      aheadCount: 2,
      hasPullRequest: false,
      hasGitHubRemote: false,
    };
    expect(reasonOf(noRemote, 'publish')).toBe('no-remote');
    expect(reasonOf(noRemote, 'push')).toBe('no-remote');
    expect(reasonOf(noRemote, 'pull')).toBe('no-remote');
    expect(selectSourceControlActions(noRemote).primary.kind).toBe('commit');
  });

  it('while the branch is being read, publish, push and pull wait rather than guess', () => {
    const reading = { ...CLEAN_PUBLISHED, publication: null, hasPullRequest: false };
    expect(reasonOf(reading, 'publish')).toBe('publication-loading');
    expect(reasonOf(reading, 'push')).toBe('publication-loading');
    expect(reasonOf(reading, 'pull')).toBe('publication-loading');
    expect(selectSourceControlActions(reading).primary.kind).not.toBe('publish');
  });

  it('a detached checkout has no branch to publish, push or pull', () => {
    const detached = { ...CLEAN_PUBLISHED, publication: 'detached' as const, branchName: null };
    expect(reasonOf(detached, 'publish')).toBe('no-branch');
    expect(reasonOf(detached, 'push')).toBe('no-branch');
    expect(reasonOf(detached, 'pull')).toBe('no-branch');
  });

  it('refuses to publish a branch that already has an upstream', () => {
    expect(reasonOf(CLEAN_PUBLISHED, 'publish')).toBe('already-published');
  });

  it('pushes only while the branch is ahead', () => {
    expect(reasonOf(CLEAN_PUBLISHED, 'push')).toBe('nothing-to-push');
    const ahead = { ...CLEAN_PUBLISHED, aheadCount: 3 };
    expect(reasonOf(ahead, 'push')).toBeNull();
    expect(selectSourceControlActions(ahead).primary.kind).toBe('push');
  });

  it('offers a pull request only when there is not one already', () => {
    expect(reasonOf(CLEAN_PUBLISHED, 'create-pr')).toBe('pr-exists');
    const noPr = { ...CLEAN_PUBLISHED, hasPullRequest: false };
    expect(selectSourceControlActions(noPr).primary.kind).toBe('create-pr');
  });

  // devstation-vzg: with no remote, git reports every commit as pushed (nothing
  // is ahead of an upstream that does not exist), so "published" alone let
  // Create PR through on a repository GitHub cannot open a PR in.
  it('refuses a pull request in a repository with no GitHub remote', () => {
    const noRemote = { ...CLEAN_PUBLISHED, hasPullRequest: false, hasGitHubRemote: false };
    expect(reasonOf(noRemote, 'create-pr')).toBe('no-github-remote');
    expect(selectSourceControlActions(noRemote).primary.kind).not.toBe('create-pr');
  });

  it('while the lanes load, Create PR waits with lanes-loading — never pr-exists or no-github-remote', () => {
    const loading = {
      ...CLEAN_PUBLISHED,
      lanesLoaded: false,
      hasPullRequest: false,
      hasGitHubRemote: false,
    };
    expect(reasonOf(loading, 'create-pr')).toBe('lanes-loading');
    expect(selectSourceControlActions(loading).primary.kind).not.toBe('create-pr');
  });

  it('names the existing pull request before the missing remote', () => {
    const both = { ...CLEAN_PUBLISHED, hasGitHubRemote: false };
    expect(reasonOf(both, 'create-pr')).toBe('pr-exists');
  });

  it('falls back to pull on a clean, published branch with a pull request', () => {
    expect(selectSourceControlActions(CLEAN_PUBLISHED).primary.kind).toBe('pull');
  });

  it('disables everything without a checkout, and reports commit as the primary', () => {
    const detached = { ...CLEAN_PUBLISHED, hasCheckout: false };
    const { primary, actions } = selectSourceControlActions(detached);
    expect(actions.every((a) => a.disabledReason === 'no-checkout')).toBe(true);
    expect(primary).toEqual({ kind: 'commit', disabledReason: 'no-checkout' });
  });

  it('holds every action while one is already running', () => {
    const busy = { ...CLEAN_PUBLISHED, busy: true, unstagedCount: 1, commitMessage: 'x' };
    expect(selectSourceControlActions(busy).actions.every((a) => a.disabledReason === 'busy')).toBe(
      true
    );
  });
});
