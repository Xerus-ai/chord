import { describe, expect, it } from 'vitest';
import { buildCreateWorkItemArgs, toTicketLink } from './create-target';
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

const jiraKeyField = resolveSmartField('PLAT-9');

const pullField = resolveSmartField('https://github.com/cli/cli/pull/14577');

const ENG_42 = {
  provider: 'linear' as const,
  id: 'ENG-42',
  url: LINEAR_URL,
  title: 'Fix login redirect',
};

const OPTIONS = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  repoId: 'repo-1',
  agentProvider: 'claude',
};

describe('buildCreateWorkItemArgs', () => {
  it('sends the shown name and the ticket in the one request', () => {
    expect(
      buildCreateWorkItemArgs(
        { kind: 'new_lane', name: 'ENG-42 Fix login redirect', ticket: ENG_42, notice: null },
        { ...OPTIONS, baseRef: 'develop' }
      )
    ).toEqual({
      id: OPTIONS.id,
      name: 'ENG-42 Fix login redirect',
      repoId: 'repo-1',
      agentProvider: 'claude',
      baseRef: 'develop',
      ticket: ENG_42,
    });
  });

  it('sends a plain name with no ticket, and a blank base as no base', () => {
    expect(
      buildCreateWorkItemArgs(
        { kind: 'new_lane', name: 'Ship it', ticket: null, notice: null },
        { ...OPTIONS, baseRef: '  ' }
      )
    ).toEqual({ id: OPTIONS.id, name: 'Ship it', repoId: 'repo-1', agentProvider: 'claude' });
  });

  it('sends a same-repository PR pick as existingBranch, with no ticket and no base', () => {
    expect(
      buildCreateWorkItemArgs(
        {
          kind: 'checkout',
          name: '#14577 Bump go-runewidth',
          branch: 'williammartin-profile-startup-cost',
          label: 'Checks out williammartin-profile-startup-cost (PR #14577)',
          notice: null,
          pullRequest: null,
        },
        { ...OPTIONS, baseRef: 'develop' }
      )
    ).toEqual({
      id: OPTIONS.id,
      name: '#14577 Bump go-runewidth',
      repoId: 'repo-1',
      agentProvider: 'claude',
      existingBranch: 'williammartin-profile-startup-cost',
    });
  });

  it('sends a fork PR pick as existingBranch plus the PR to fetch it from', () => {
    const pullRequest = {
      number: 14586,
      headRef: 'fix/display-url-escaped-path',
      headOwner: 'bodapatisaikrishna',
      headCloneUrl: 'https://github.com/bodapatisaikrishna/cli.git',
      maintainerCanModify: true,
      baseRemote: 'origin',
    };

    expect(
      buildCreateWorkItemArgs(
        {
          kind: 'checkout',
          name: '#14586 Preserve percent-encoded path',
          branch: 'fix/display-url-escaped-path',
          label: 'Checks out fix/display-url-escaped-path from bodapatisaikrishna/cli (PR #14586)',
          notice: null,
          pullRequest,
        },
        OPTIONS
      )
    ).toEqual({
      id: OPTIONS.id,
      name: '#14586 Preserve percent-encoded path',
      repoId: 'repo-1',
      agentProvider: 'claude',
      existingBranch: 'fix/display-url-escaped-path',
      pullRequest,
    });
  });

  it('has no request while a lookup is pending or a PR cannot be checked out', () => {
    expect(
      buildCreateWorkItemArgs({ kind: 'looking_up', label: 'Looking up ENG-42…' }, OPTIONS)
    ).toBeNull();
    expect(
      buildCreateWorkItemArgs({ kind: 'unavailable', message: "GitHub isn't connected" }, OPTIONS)
    ).toBeNull();
  });
});

describe('toTicketLink', () => {
  it('links a pasted ticket URL or key as a ticket with no title yet', () => {
    expect(toTicketLink(resolveSmartField('https://github.com/acme/api/issues/1234')!)).toEqual({
      provider: 'github',
      id: '1234',
      url: 'https://github.com/acme/api/issues/1234',
      title: null,
    });
    expect(toTicketLink(linearField!)).toEqual({
      provider: 'linear',
      id: 'ENG-42',
      url: LINEAR_URL,
      title: null,
    });
    expect(toTicketLink(jiraKeyField!)).toEqual({
      provider: 'jira',
      id: 'PLAT-9',
      url: null,
      title: null,
    });
  });

  it('is null for a pull request or text that is not a ticket', () => {
    expect(toTicketLink(pullField!)).toBeNull();
    expect(toTicketLink(resolveSmartField('https://example.com/whatever')!)).toBeNull();
  });
});
