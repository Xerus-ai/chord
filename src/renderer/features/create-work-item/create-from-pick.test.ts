import { describe, expect, it } from 'vitest';
import type { BranchPick, PullRequestPick } from '@shared/create-from';
import type { Issue } from '@shared/tasks';
import { resolvePickTarget } from './create-from-pick';
import { buildCreateWorkItemArgs, resolveCreateTarget } from './create-target';
import { resolveSmartField } from './smart-resolve';

/**
 * What a pick in Create from… creates (plan §Phase 3 slice 2), through the
 * same target and request slice 1 built for the Smart field:
 *   - an issue is a new lane from the base, named from its key and title, with
 *     the ticket linked — exactly what pasting its URL makes once looked up;
 *   - a PR checks out its head branch exactly as a pasted PR URL does, forks
 *     included;
 *   - a branch is `existingBranch` in a new checkout;
 *   - a branch checked out elsewhere is never reused: its holder is named and
 *     the only way on is "Branch off <branch> instead", a new lane with
 *     `baseRef = <branch>` — never a silent switch or a `-1` suffix.
 * The picker and a pasted PR URL are the only senders of `existingBranch`.
 */

/** Another remote's branch whose own name origin already has: checked out under its remote's name. */

const OPTIONS = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  repoId: 'repo-1',
  agentProvider: 'claude',
};

const GITHUB_ISSUE: Issue = {
  provider: 'github',
  identifier: '#12',
  title: 'Retry failed webhooks',
  url: 'https://github.com/acme/api/issues/12',
};

const LINEAR_ISSUE: Issue = {
  provider: 'linear',
  identifier: 'ENG-42',
  title: 'Fix login redirect',
  url: 'https://linear.app/acme/issue/ENG-42/fix-login-redirect',
};

const JIRA_ISSUE: Issue = {
  provider: 'jira',
  identifier: 'PLAT-9',
  title: 'Rotate signing keys',
  url: 'https://acme.atlassian.net/browse/PLAT-9',
};

const PULL: PullRequestPick = {
  owner: 'acme',
  repo: 'api',
  number: 14577,
  title: 'Bump go-runewidth',
  url: 'https://github.com/acme/api/pull/14577',
  authorLogin: 'alice',
  isDraft: false,
};

function sameRepoCheckout(branch = 'feat/runewidth') {
  return {
    number: 14577,
    title: 'Bump go-runewidth',
    url: 'https://github.com/acme/api/pull/14577',
    headRef: branch,
    headOwner: 'acme',
    headRepo: 'acme/api',
    headCloneUrl: 'https://github.com/acme/api.git',
    crossRepository: false,
    maintainerCanModify: false,
    branch,
    baseRemote: 'origin',
  };
}

const ROOT = 'C:\\code\\api';

const LANE = 'C:\\chord\\worktrees\\api\\busy';

function localPick(name: string, holder: BranchPick['holder'] = null): BranchPick {
  return { name, source: 'local', remote: null, localBranch: name, tracking: null, holder };
}

const FREE = localPick('feat/free');

const REMOTE_ONLY: BranchPick = {
  name: 'feat/teammate',
  source: 'remote',
  remote: 'origin',
  localBranch: 'feat/teammate',
  tracking: { remote: 'origin', branch: 'feat/teammate' },
  holder: null,
};

const UPSTREAM: BranchPick = {
  name: 'upstream/shared',
  source: 'remote',
  remote: 'upstream',
  localBranch: 'upstream/shared',
  tracking: { remote: 'upstream', branch: 'shared' },
  holder: null,
};

const IN_ROOT = localPick('main', { kind: 'checkout', path: ROOT });

const IN_LANE = localPick('feat/busy', {
  kind: 'work_item',
  path: LANE,
  workItemId: 'item-7',
  workItemName: 'Fix login',
});

const BRANCHES = [FREE, REMOTE_ONLY, UPSTREAM, IN_ROOT, IN_LANE];

describe('picking an issue', () => {
  it('makes the same target as its pasted URL once found: named from key and title, ticket linked', () => {
    const picked = resolvePickTarget({
      pick: { kind: 'issue', issue: GITHUB_ISSUE },
      pullRequestLookup: null,
      branches: BRANCHES,
    });
    const ticket = {
      provider: 'github' as const,
      id: '12',
      url: GITHUB_ISSUE.url,
      title: GITHUB_ISSUE.title,
    };

    expect(picked).toEqual({
      kind: 'new_lane',
      name: '#12 Retry failed webhooks',
      ticket,
      notice: null,
    });
    expect(picked).toEqual(
      resolveCreateTarget({
        resolution: resolveSmartField(GITHUB_ISSUE.url),
        issueLookup: { status: 'found', ticket },
        pullRequestLookup: null,
      })
    );
  });

  it('names a Linear or Jira issue by its key and title', () => {
    expect(
      resolvePickTarget({
        pick: { kind: 'issue', issue: LINEAR_ISSUE },
        pullRequestLookup: null,
        branches: [],
      })
    ).toEqual({
      kind: 'new_lane',
      name: 'ENG-42 Fix login redirect',
      ticket: {
        provider: 'linear',
        id: 'ENG-42',
        url: LINEAR_ISSUE.url,
        title: LINEAR_ISSUE.title,
      },
      notice: null,
    });
    expect(
      resolvePickTarget({
        pick: { kind: 'issue', issue: JIRA_ISSUE },
        pullRequestLookup: null,
        branches: [],
      })
    ).toMatchObject({
      kind: 'new_lane',
      name: 'PLAT-9 Rotate signing keys',
      ticket: { provider: 'jira', id: 'PLAT-9', url: JIRA_ISSUE.url, title: JIRA_ISSUE.title },
    });
  });

  it('sends a new lane from the base with the ticket, never an existing branch', () => {
    const target = resolvePickTarget({
      pick: { kind: 'issue', issue: GITHUB_ISSUE },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(buildCreateWorkItemArgs(target, { ...OPTIONS, baseRef: 'develop' })).toEqual({
      ...OPTIONS,
      name: '#12 Retry failed webhooks',
      baseRef: 'develop',
      ticket: { provider: 'github', id: '12', url: GITHUB_ISSUE.url, title: GITHUB_ISSUE.title },
    });
  });
});

describe('picking a pull request', () => {
  it('waits for its head branch, like a pasted PR URL', () => {
    const target = resolvePickTarget({
      pick: { kind: 'pull_request', pullRequest: PULL },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(target.kind).toBe('looking_up');
    if (target.kind === 'looking_up') expect(target.label).toContain('#14577');
    expect(buildCreateWorkItemArgs(target, OPTIONS)).toBeNull();
  });

  it('checks out its head branch exactly as the pasted PR URL does', () => {
    const lookup = { status: 'found' as const, checkout: sameRepoCheckout() };
    const picked = resolvePickTarget({
      pick: { kind: 'pull_request', pullRequest: PULL },
      pullRequestLookup: lookup,
      branches: BRANCHES,
    });

    expect(picked).toEqual(
      resolveCreateTarget({
        resolution: resolveSmartField(PULL.url),
        issueLookup: null,
        pullRequestLookup: lookup,
      })
    );
    expect(buildCreateWorkItemArgs(picked, { ...OPTIONS, baseRef: 'develop' })).toEqual({
      ...OPTIONS,
      name: '#14577 Bump go-runewidth',
      existingBranch: 'feat/runewidth',
    });
  });

  it('sends a fork PR with the PR its branch is fetched from', () => {
    const picked = resolvePickTarget({
      pick: { kind: 'pull_request', pullRequest: PULL },
      pullRequestLookup: {
        status: 'found',
        checkout: {
          ...sameRepoCheckout('fix/escape'),
          headOwner: 'contributor',
          headRepo: 'contributor/api',
          headCloneUrl: 'https://github.com/contributor/api.git',
          crossRepository: true,
          maintainerCanModify: true,
        },
      },
      branches: BRANCHES,
    });

    expect(buildCreateWorkItemArgs(picked, OPTIONS)).toEqual({
      ...OPTIONS,
      name: '#14577 Bump go-runewidth',
      existingBranch: 'fix/escape',
      pullRequest: {
        number: 14577,
        headRef: 'fix/escape',
        headOwner: 'contributor',
        headCloneUrl: 'https://github.com/contributor/api.git',
        maintainerCanModify: true,
        baseRemote: 'origin',
      },
    });
  });

  it('refuses a PR whose branch is checked out elsewhere, naming where', () => {
    const picked = resolvePickTarget({
      pick: { kind: 'pull_request', pullRequest: PULL },
      pullRequestLookup: { status: 'found', checkout: sameRepoCheckout('feat/busy') },
      branches: BRANCHES,
    });

    expect(picked).toMatchObject({ kind: 'held', branch: 'feat/busy', holder: IN_LANE.holder });
    expect(buildCreateWorkItemArgs(picked, OPTIONS)).toBeNull();
  });
});

describe('picking a branch', () => {
  it('checks out a free local branch as itself, with no base', () => {
    const picked = resolvePickTarget({
      pick: { kind: 'branch', branch: FREE },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(picked).toEqual({
      kind: 'checkout',
      name: 'feat/free',
      branch: 'feat/free',
      label: 'Checks out feat/free',
      notice: null,
      pullRequest: null,
    });
    // Advanced's base doesn't apply to a checkout.
    expect(buildCreateWorkItemArgs(picked, { ...OPTIONS, baseRef: 'develop' })).toEqual({
      ...OPTIONS,
      name: 'feat/free',
      existingBranch: 'feat/free',
    });
  });

  it("checks out a branch only the remote has by its own name, saying where it's from", () => {
    const picked = resolvePickTarget({
      pick: { kind: 'branch', branch: REMOTE_ONLY },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(picked).toMatchObject({
      kind: 'checkout',
      branch: 'feat/teammate',
      label: 'Checks out feat/teammate from origin',
      tracking: { remote: 'origin', branch: 'feat/teammate' },
    });
    expect(buildCreateWorkItemArgs(picked, OPTIONS)).toEqual({
      ...OPTIONS,
      name: 'feat/teammate',
      existingBranch: 'feat/teammate',
      trackRemoteBranch: { remote: 'origin', branch: 'feat/teammate' },
    });
  });

  it("checks out another remote's branch as the local branch planned for it, tracking it", () => {
    const picked = resolvePickTarget({
      pick: { kind: 'branch', branch: UPSTREAM },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(picked).toEqual({
      kind: 'checkout',
      name: 'upstream/shared',
      branch: 'upstream/shared',
      label: 'Checks out upstream/shared from upstream',
      notice: null,
      pullRequest: null,
      tracking: { remote: 'upstream', branch: 'shared' },
    });
    expect(buildCreateWorkItemArgs(picked, { ...OPTIONS, baseRef: 'develop' })).toEqual({
      ...OPTIONS,
      name: 'upstream/shared',
      existingBranch: 'upstream/shared',
      trackRemoteBranch: { remote: 'upstream', branch: 'shared' },
    });
  });

  it("never reuses a branch a lane has: names the work item, and there's nothing to send", () => {
    const picked = resolvePickTarget({
      pick: { kind: 'branch', branch: IN_LANE },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(picked).toMatchObject({ kind: 'held', branch: 'feat/busy', holder: IN_LANE.holder });
    if (picked.kind !== 'held') return;
    expect(picked.message).toContain('feat/busy');
    expect(picked.message).toContain('Fix login');
    expect(picked.message).toMatch(/already checked out/);
    expect(buildCreateWorkItemArgs(picked, OPTIONS)).toBeNull();
  });

  it('never reuses the branch the main checkout is on, naming that folder', () => {
    const picked = resolvePickTarget({
      pick: { kind: 'branch', branch: IN_ROOT },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(picked).toMatchObject({ kind: 'held', branch: 'main' });
    if (picked.kind === 'held') expect(picked.message).toContain(ROOT);
  });

  it('refuses a branch the latest listing shows as taken since it was picked', () => {
    const taken: BranchPick = { ...FREE, holder: { kind: 'checkout', path: 'C:\\by-hand' } };
    const picked = resolvePickTarget({
      pick: { kind: 'branch', branch: FREE },
      pullRequestLookup: null,
      branches: [taken],
    });

    expect(picked).toMatchObject({ kind: 'held', branch: 'feat/free' });
  });
});
