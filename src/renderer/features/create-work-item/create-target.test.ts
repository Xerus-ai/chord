import { describe, expect, it } from 'vitest';
import { resolveCreateTarget } from './create-target';
import { resolveSmartField } from './smart-resolve';

/**
 * What the create dialog shows before Create, and the one request it sends
 * (plan §Phase 3 slice 1). The dialog renders `resolveCreateTarget` and sends
 * `buildCreateWorkItemArgs` of the same target, so what is shown is what is
 * created: a ticket is named from its key and title; a lookup that fails
 * names its reason and the key-only name; while a lookup is pending there is
 * no request at all (Create and Cmd+Enter both have nothing to send); a
 * pasted PR URL checks out the PR's head branch and links no ticket.
 */

/** What the PR lookup returns: the PR's head, plus the local branch planned for it. */

const LINEAR_URL = 'https://linear.app/acme/issue/ENG-42/fix-login-redirect';

const linearField = resolveSmartField(LINEAR_URL);

const githubIssueField = resolveSmartField('https://github.com/cli/cli/issues/2');

const jiraKeyField = resolveSmartField('PLAT-9');

const pullField = resolveSmartField('https://github.com/cli/cli/pull/14577');

const forkPullField = resolveSmartField('https://github.com/cli/cli/pull/14586');

function sameRepoCheckout() {
  return {
    number: 14577,
    title: 'Bump go-runewidth to v0.0.30 for faster startup',
    url: 'https://github.com/cli/cli/pull/14577',
    headRef: 'williammartin-profile-startup-cost',
    headOwner: 'cli',
    headRepo: 'cli/cli',
    headCloneUrl: 'https://github.com/cli/cli.git',
    crossRepository: false,
    maintainerCanModify: false,
    branch: 'williammartin-profile-startup-cost',
    baseRemote: 'origin',
  };
}

function forkCheckout(overrides: Record<string, unknown> = {}) {
  return {
    number: 14586,
    title: 'Preserve percent-encoded path in DisplayURL',
    url: 'https://github.com/cli/cli/pull/14586',
    headRef: 'fix/display-url-escaped-path',
    headOwner: 'bodapatisaikrishna',
    headRepo: 'bodapatisaikrishna/cli',
    headCloneUrl: 'https://github.com/bodapatisaikrishna/cli.git',
    crossRepository: true,
    maintainerCanModify: true,
    branch: 'fix/display-url-escaped-path',
    baseRemote: 'origin',
    ...overrides,
  };
}

const ENG_42 = {
  provider: 'linear' as const,
  id: 'ENG-42',
  url: LINEAR_URL,
  title: 'Fix login redirect',
};

describe('resolveCreateTarget', () => {
  it('has nothing to create from an empty field', () => {
    expect(
      resolveCreateTarget({ resolution: null, issueLookup: null, pullRequestLookup: null })
    ).toBeNull();
  });

  it('creates a plain name as typed, with no ticket', () => {
    expect(
      resolveCreateTarget({
        resolution: resolveSmartField('Ship it'),
        issueLookup: null,
        pullRequestLookup: null,
      })
    ).toEqual({ kind: 'new_lane', name: 'Ship it', ticket: null, notice: null });
  });

  it('waits on a ticket from the first keystroke, before the debounced lookup starts', () => {
    const target = resolveCreateTarget({
      resolution: linearField,
      issueLookup: null,
      pullRequestLookup: null,
    });

    expect(target?.kind).toBe('looking_up');
    if (target?.kind === 'looking_up') expect(target.label).toContain('ENG-42');
  });

  it('waits while the lookup is in flight', () => {
    const target = resolveCreateTarget({
      resolution: linearField,
      issueLookup: { status: 'looking_up' },
      pullRequestLookup: null,
    });

    expect(target?.kind).toBe('looking_up');
  });

  it('names a found ticket from its key and title, and carries the ticket', () => {
    expect(
      resolveCreateTarget({
        resolution: linearField,
        issueLookup: { status: 'found', ticket: ENG_42 },
        pullRequestLookup: null,
      })
    ).toEqual({
      kind: 'new_lane',
      name: 'ENG-42 Fix login redirect',
      ticket: ENG_42,
      notice: null,
    });
  });

  it('names a found GitHub issue as #n and its title', () => {
    const ticket = {
      provider: 'github' as const,
      id: '2',
      url: 'https://github.com/cli/cli/issues/2',
      title: 'Reimagine how the app determines its context',
    };

    expect(
      resolveCreateTarget({
        resolution: githubIssueField,
        issueLookup: { status: 'found', ticket },
        pullRequestLookup: null,
      })
    ).toEqual({
      kind: 'new_lane',
      name: '#2 Reimagine how the app determines its context',
      ticket,
      notice: null,
    });
  });

  it("names the reason a provider isn't connected, and uses the key-only name", () => {
    const target = resolveCreateTarget({
      resolution: linearField,
      issueLookup: {
        status: 'failed',
        error: { type: 'not_connected', message: 'Linear token not set.' },
      },
      pullRequestLookup: null,
    });

    expect(target).toMatchObject({
      kind: 'new_lane',
      name: 'ENG-42',
      ticket: { provider: 'linear', id: 'ENG-42', url: LINEAR_URL, title: null },
    });
    if (target?.kind !== 'new_lane') return;
    expect(target.notice).toMatch(/Linear isn't connected/);
    expect(target.notice).toContain('ENG-42');
  });

  it('names a ticket that was not found, keeping a bare key without a URL', () => {
    const target = resolveCreateTarget({
      resolution: jiraKeyField,
      issueLookup: {
        status: 'failed',
        error: { type: 'not_found', message: 'Issue does not exist' },
      },
      pullRequestLookup: null,
    });

    expect(target).toMatchObject({
      kind: 'new_lane',
      name: 'PLAT-9',
      ticket: { provider: 'jira', id: 'PLAT-9', url: null, title: null },
    });
    if (target?.kind === 'new_lane') expect(target.notice).toMatch(/not found/i);
  });

  it('names any other lookup failure with what the provider said', () => {
    const target = resolveCreateTarget({
      resolution: githubIssueField,
      issueLookup: { status: 'failed', error: { type: 'error', message: 'Server Error (500)' } },
      pullRequestLookup: null,
    });

    expect(target).toMatchObject({
      kind: 'new_lane',
      name: '#2',
      ticket: {
        provider: 'github',
        id: '2',
        url: 'https://github.com/cli/cli/issues/2',
        title: null,
      },
    });
    if (target?.kind === 'new_lane') expect(target.notice).toContain('Server Error (500)');
  });

  it('waits on a pasted PR URL until its head branch is known', () => {
    const target = resolveCreateTarget({
      resolution: pullField,
      issueLookup: null,
      pullRequestLookup: null,
    });

    expect(target?.kind).toBe('looking_up');
    if (target?.kind === 'looking_up') expect(target.label).toContain('#14577');
  });

  it("checks out a same-repository PR's head branch, named from the PR", () => {
    expect(
      resolveCreateTarget({
        resolution: pullField,
        issueLookup: null,
        pullRequestLookup: { status: 'found', checkout: sameRepoCheckout() },
      })
    ).toEqual({
      kind: 'checkout',
      name: '#14577 Bump go-runewidth to v0.0.30 for faster startup',
      branch: 'williammartin-profile-startup-cost',
      label: 'Checks out williammartin-profile-startup-cost (PR #14577)',
      notice: null,
      // Same repository: the branch is on origin; nothing to fetch from a pull ref.
      pullRequest: null,
    });
  });

  it('checks out a fork PR into the branch planned for it, naming the fork', () => {
    expect(
      resolveCreateTarget({
        resolution: forkPullField,
        issueLookup: null,
        pullRequestLookup: { status: 'found', checkout: forkCheckout() },
      })
    ).toEqual({
      kind: 'checkout',
      name: '#14586 Preserve percent-encoded path in DisplayURL',
      branch: 'fix/display-url-escaped-path',
      label: 'Checks out fix/display-url-escaped-path from bodapatisaikrishna/cli (PR #14586)',
      notice: null,
      pullRequest: {
        number: 14586,
        headRef: 'fix/display-url-escaped-path',
        headOwner: 'bodapatisaikrishna',
        headCloneUrl: 'https://github.com/bodapatisaikrishna/cli.git',
        maintainerCanModify: true,
        baseRemote: 'origin',
      },
    });
  });

  it("says before Create that a fork which refuses maintainer pushes can't be pushed to", () => {
    const target = resolveCreateTarget({
      resolution: forkPullField,
      issueLookup: null,
      pullRequestLookup: {
        status: 'found',
        checkout: forkCheckout({ maintainerCanModify: false, branch: 'bodapatisaikrishna/main' }),
      },
    });

    expect(target).toMatchObject({
      kind: 'checkout',
      branch: 'bodapatisaikrishna/main',
      label: 'Checks out bodapatisaikrishna/main from bodapatisaikrishna/cli (PR #14586)',
      pullRequest: { maintainerCanModify: false },
    });
    if (target?.kind === 'checkout') {
      expect(target.notice).toMatch(/doesn't accept maintainer pushes/);
    }
  });

  it('checks out a PR whose fork was deleted, and says so', () => {
    const target = resolveCreateTarget({
      resolution: forkPullField,
      issueLookup: null,
      pullRequestLookup: {
        status: 'found',
        checkout: forkCheckout({
          headOwner: 'departed',
          headRepo: null,
          headCloneUrl: null,
          maintainerCanModify: false,
        }),
      },
    });

    expect(target).toMatchObject({
      kind: 'checkout',
      label: "Checks out fix/display-url-escaped-path from departed's deleted fork (PR #14586)",
      pullRequest: { headCloneUrl: null, maintainerCanModify: false },
    });
    if (target?.kind === 'checkout') expect(target.notice).toMatch(/deleted/);
  });

  it('cannot check out a PR whose head could not be read, and says why', () => {
    const notConnected = resolveCreateTarget({
      resolution: pullField,
      issueLookup: null,
      pullRequestLookup: {
        status: 'failed',
        error: { type: 'not_connected', message: 'Not authenticated' },
      },
    });
    const taken = resolveCreateTarget({
      resolution: forkPullField,
      issueLookup: null,
      pullRequestLookup: {
        status: 'failed',
        error: {
          type: 'branch_exists',
          message: 'fix-typo and alice/fix-typo already exist in this repository',
        },
      },
    });

    expect(notConnected?.kind).toBe('unavailable');
    if (notConnected?.kind === 'unavailable') {
      expect(notConnected.message).toMatch(/GitHub isn't connected/);
    }
    expect(taken?.kind).toBe('unavailable');
    if (taken?.kind === 'unavailable') expect(taken.message).toContain('alice/fix-typo');
  });
});
