import { describe, expect, it } from 'vitest';
import type { BranchPick, PullRequestPick } from '@shared/create-from';
import {
  applyBranchHolders,
  describeBranchHolder,
  describeCreateFailure,
  resolvePickTarget,
} from './create-from-pick';
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

describe('"Branch off <branch> instead"', () => {
  it('is a new lane whose base is that branch, never a checkout of it', () => {
    const target = resolvePickTarget({
      pick: { kind: 'branch_off', branch: 'feat/busy' },
      pullRequestLookup: null,
      branches: BRANCHES,
    });

    expect(target).toEqual({
      kind: 'branch_off',
      name: 'feat/busy',
      baseRef: 'feat/busy',
      label: 'New branch from feat/busy',
    });
    // The picked branch is the base: Advanced's base doesn't override it.
    expect(buildCreateWorkItemArgs(target, { ...OPTIONS, baseRef: 'develop' })).toEqual({
      ...OPTIONS,
      name: 'feat/busy',
      baseRef: 'feat/busy',
    });
  });
});

describe('applyBranchHolders', () => {
  it('turns a pasted PR URL whose branch is checked out elsewhere into the same refusal', () => {
    const pasted = resolveCreateTarget({
      resolution: resolveSmartField(PULL.url),
      issueLookup: null,
      pullRequestLookup: { status: 'found', checkout: sameRepoCheckout('main') },
    });

    expect(applyBranchHolders(pasted, BRANCHES)).toMatchObject({
      kind: 'held',
      branch: 'main',
      holder: IN_ROOT.holder,
    });
  });

  it('leaves every other target as it is', () => {
    const free = resolveCreateTarget({
      resolution: resolveSmartField(PULL.url),
      issueLookup: null,
      pullRequestLookup: { status: 'found', checkout: sameRepoCheckout('feat/free') },
    });
    const named = resolveCreateTarget({
      resolution: resolveSmartField('main'),
      issueLookup: null,
      pullRequestLookup: null,
    });

    expect(applyBranchHolders(free, BRANCHES)).toEqual(free);
    // Typed text is a name, not a branch: `main` is a new lane, never held.
    expect(applyBranchHolders(named, BRANCHES)).toEqual(named);
    expect(applyBranchHolders(null, BRANCHES)).toBeNull();
  });
});

describe('describeBranchHolder', () => {
  it('names the folder, or the work item whose lane has it', () => {
    expect(describeBranchHolder({ kind: 'checkout', path: ROOT })).toBe(`checked out in ${ROOT}`);
    expect(
      describeBranchHolder({
        kind: 'work_item',
        path: LANE,
        workItemId: 'item-7',
        workItemName: 'Fix login',
      })
    ).toBe('in work item Fix login');
  });
});

describe('describeCreateFailure', () => {
  it('offers to branch off a branch the create was refused for being checked out', () => {
    const failure = describeCreateFailure({
      type: 'branch_checked_out',
      branch: 'feat/race',
      path: 'C:\\by-hand',
      message: 'feat/race is already checked out in C:\\by-hand.',
    });

    expect(failure.message).toContain('feat/race is already checked out in C:\\by-hand.');
    expect(failure.branchOff).toBe('feat/race');
  });

  it('offers nothing for any other refusal', () => {
    expect(
      describeCreateFailure({
        type: 'base_not_found',
        message: 'Base branch develop was not found.',
      })
    ).toEqual({
      message: expect.stringContaining('Base branch develop was not found.') as string,
      gitOutput: null,
      branchOff: null,
    });
    expect(describeCreateFailure({ type: 'invalid_request' }).message).toContain('invalid_request');
  });

  // devstation-kcvy: what git said is kept apart, for the dialog to fold away
  // instead of running it on after the sentence.
  it("keeps git's output apart from the sentence when the remote could not be asked", () => {
    expect(
      describeCreateFailure({
        type: 'fetch_failed',
        message: 'Could not ask the remote for release/2.0.',
        gitOutput: "fatal: 'origin' does not appear to be a git repository",
      })
    ).toEqual({
      message: 'Create work item failed: Could not ask the remote for release/2.0.',
      gitOutput: "fatal: 'origin' does not appear to be a git repository",
      branchOff: null,
    });
  });
});
