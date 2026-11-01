import { describe, expect, it } from 'vitest';
import type { LanePr, LanePullRequest, WorkItemLanePullRequests } from '@shared/lane-pull-requests';
import type { SourceControlPolicyInput } from '../source-control/policy';
import { selectBandAction, type BandActionKind } from './band-policy';
import { canMergeLanePr, selectFocusedLane, toLanePrState } from './lane-band-input';

const REPO = 'https://github.com/acme/chord';

function pr(number: number, overrides: Partial<LanePr> = {}): LanePr {
  return {
    number,
    url: `${REPO}/pull/${number}`,
    title: `PR ${number}`,
    status: 'open',
    isDraft: false,
    headRefName: `branch-${number}`,
    baseRefName: 'main',
    headRefOid: 'a'.repeat(40),
    mergeableStatus: 'MERGEABLE',
    reviewDecision: null,
    checks: 'none',
    ...overrides,
  };
}

function lane(worktreeId: string, isPrimary: boolean, lanePr: LanePr | null): LanePullRequest {
  return {
    worktreeId,
    branchName: `raghav/${worktreeId}`,
    isPrimary,
    targetRef: 'origin/main',
    prBase: 'main',
    targetError: null,
    pr: lanePr,
  };
}

/** The primary already has PR #7; the secondary lane has none. */
const LANES: WorkItemLanePullRequests = {
  repositoryUrl: REPO,
  lanes: [lane('primary', true, pr(7)), lane('secondary', false, null)],
};

/** A pushed, clean worktree: the next step is opening its PR, if it has none. */
function sourceControlFor(focused: LanePullRequest | null): SourceControlPolicyInput {
  return {
    hasCheckout: true,
    stagedCount: 0,
    unstagedCount: 0,
    conflictCount: 0,
    aheadCount: 0,
    publication: 'published',
    branchName: focused?.branchName ?? null,
    hasPullRequest: focused?.pr !== null && focused?.pr !== undefined,
    hasGitHubRemote: LANES.repositoryUrl !== null,
    lanesLoaded: true,
    commitMessage: '',
    busy: false,
  };
}

function bandFor(worktreeId: string, lanes = LANES) {
  const focused = selectFocusedLane(lanes, worktreeId);
  return selectBandAction({
    sourceControl: sourceControlFor(focused),
    canMerge: canMergeLanePr(focused?.pr ?? null, lanes.repositoryUrl),
    prState: toLanePrState(focused?.pr ?? null),
    workItemDone: false,
    focusedArtifactStatus: null,
  });
}

function reasonOf(band: ReturnType<typeof selectBandAction>, kind: BandActionKind) {
  return [band.primary, ...band.menu].find((action) => action?.kind === kind)?.disabledReason;
}

describe('selectFocusedLane', () => {
  it('is the lane the user has open', () => {
    expect(selectFocusedLane(LANES, 'secondary')?.worktreeId).toBe('secondary');
  });

  it('is null while the lanes are loading or before a lane is focused', () => {
    expect(selectFocusedLane(undefined, 'secondary')).toBeNull();
    expect(selectFocusedLane(LANES, null)).toBeNull();
  });

  it('is null for a lane that is not in the list (archived or another item)', () => {
    expect(selectFocusedLane(LANES, 'gone')).toBeNull();
  });
});

describe('the band follows the focused lane, not the work item', () => {
  it("offers Create PR on a secondary lane while the primary's PR is open", () => {
    const band = bandFor('secondary');
    expect(band.primary?.kind).toBe('create-pr');
  });

  it('refuses Create PR on the lane that already has one', () => {
    const band = bandFor('primary');
    expect(band.primary?.kind).not.toBe('create-pr');
    expect(reasonOf(band, 'create-pr')).toBe('pr-exists');
  });

  it("offers Merge only for the focused lane's own mergeable PR", () => {
    expect(bandFor('primary').primary?.kind).toBe('merge');
    expect(reasonOf(bandFor('secondary'), 'merge')).toBe('not-mergeable');
  });

  it("offers Mark done when the focused lane's PR is merged, not another lane's", () => {
    const lanes: WorkItemLanePullRequests = {
      repositoryUrl: REPO,
      lanes: [lane('primary', true, pr(7)), lane('secondary', false, pr(12, { status: 'merged' }))],
    };
    expect(bandFor('secondary', lanes).primary?.kind).toBe('mark-done');
    expect(reasonOf(bandFor('primary', lanes), 'mark-done')).toBe('pr-not-merged');
  });
});

describe('while the lanes load', () => {
  it('Create PR waits with lanes-loading, not a guessed reason', () => {
    const focused = selectFocusedLane(undefined, 'secondary');
    const band = selectBandAction({
      sourceControl: {
        ...sourceControlFor(focused),
        hasGitHubRemote: false,
        lanesLoaded: false,
      },
      canMerge: canMergeLanePr(focused?.pr ?? null, null),
      prState: toLanePrState(focused?.pr ?? null),
      workItemDone: false,
      focusedArtifactStatus: null,
    });
    expect(band.primary?.kind).not.toBe('create-pr');
    expect(reasonOf(band, 'create-pr')).toBe('lanes-loading');
  });
});

describe('a repository with no GitHub remote (devstation-vzg)', () => {
  it('does not offer Create PR on any lane, and says why', () => {
    const lanes: WorkItemLanePullRequests = {
      repositoryUrl: null,
      lanes: [lane('primary', true, null), lane('secondary', false, null)],
    };
    for (const id of ['primary', 'secondary']) {
      const focused = selectFocusedLane(lanes, id);
      const band = selectBandAction({
        sourceControl: {
          ...sourceControlFor(focused),
          hasGitHubRemote: lanes.repositoryUrl !== null,
        },
        canMerge: canMergeLanePr(focused?.pr ?? null, lanes.repositoryUrl),
        prState: toLanePrState(focused?.pr ?? null),
        workItemDone: false,
        focusedArtifactStatus: null,
      });
      expect(band.primary?.kind).not.toBe('create-pr');
      expect(reasonOf(band, 'create-pr')).toBe('no-github-remote');
    }
  });
});

describe('toLanePrState', () => {
  it('treats draft as a state of its own', () => {
    expect(toLanePrState(pr(1, { isDraft: true }))).toBe('draft');
  });

  it('reads merged and closed as they are, anything else as open', () => {
    expect(toLanePrState(pr(1, { status: 'merged' }))).toBe('merged');
    expect(toLanePrState(pr(1, { status: 'closed' }))).toBe('closed');
    expect(toLanePrState(pr(1, { status: 'open' }))).toBe('open');
  });

  it('is null without a PR', () => {
    expect(toLanePrState(null)).toBeNull();
  });
});

describe('canMergeLanePr', () => {
  it('is true for an open, ready, non-conflicting PR in a known repository', () => {
    expect(canMergeLanePr(pr(1), REPO)).toBe(true);
  });

  it('is false for a draft, a conflicting, a closed PR, or no repository', () => {
    expect(canMergeLanePr(pr(1, { isDraft: true }), REPO)).toBe(false);
    expect(canMergeLanePr(pr(1, { mergeableStatus: 'CONFLICTING' }), REPO)).toBe(false);
    expect(canMergeLanePr(pr(1, { status: 'closed' }), REPO)).toBe(false);
    expect(canMergeLanePr(pr(1), null)).toBe(false);
    expect(canMergeLanePr(null, REPO)).toBe(false);
  });
});
