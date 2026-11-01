import { describe, expect, it } from 'vitest';
import type { SourceControlPolicyInput } from '../source-control/policy';
import { selectBandAction, type BandActionKind, type BandPolicyInput } from './band-policy';

/** A worktree with nothing to do: clean, published, its PR already open. */
const CLEAN: SourceControlPolicyInput = {
  hasCheckout: true,
  stagedCount: 0,
  unstagedCount: 0,
  conflictCount: 0,
  aheadCount: 0,
  publication: 'published',
  branchName: 'feat/right-rail',
  hasPullRequest: true,
  hasGitHubRemote: true,
  lanesLoaded: true,
  commitMessage: 'Add the band',
  busy: false,
};

const BASE: BandPolicyInput = {
  sourceControl: CLEAN,
  canMerge: false,
  prState: 'open',
  workItemDone: false,
  focusedArtifactStatus: null,
};

function primaryOf(input: Partial<BandPolicyInput>): BandActionKind | null {
  return selectBandAction({ ...BASE, ...input }).primary?.kind ?? null;
}

describe('selectBandAction — one row per band state in the prototype', () => {
  it('dirty tree, no PR yet: Commit', () => {
    expect(
      primaryOf({
        sourceControl: {
          ...CLEAN,
          unstagedCount: 10,
          publication: 'unpublished',
          hasPullRequest: false,
        },
        prState: null,
      })
    ).toBe('commit');
  });

  it('clean tree on an unpublished branch: Publish', () => {
    expect(
      primaryOf({
        sourceControl: { ...CLEAN, publication: 'unpublished', hasPullRequest: false },
        prState: null,
      })
    ).toBe('publish');
  });

  it('clean tree, commits ahead: Push', () => {
    expect(
      primaryOf({
        sourceControl: { ...CLEAN, aheadCount: 2, hasPullRequest: false },
        prState: null,
      })
    ).toBe('push');
  });

  it('pushed, no pull request: Create PR', () => {
    expect(primaryOf({ sourceControl: { ...CLEAN, hasPullRequest: false }, prState: null })).toBe(
      'create-pr'
    );
  });

  it('PR open, a check failing, tree dirty: still Commit — the work outranks the PR', () => {
    expect(primaryOf({ sourceControl: { ...CLEAN, unstagedCount: 10 } })).toBe('commit');
  });

  it('all green and mergeable: Merge', () => {
    expect(primaryOf({ canMerge: true })).toBe('merge');
  });

  it('merged: Mark done', () => {
    expect(primaryOf({ prState: 'merged' })).toBe('mark-done');
  });

  it('an artifact tab has focus: Approve, whatever git says', () => {
    expect(primaryOf({ focusedArtifactStatus: 'in_review', canMerge: true })).toBe('approve');
    expect(
      primaryOf({ focusedArtifactStatus: 'draft', sourceControl: { ...CLEAN, unstagedCount: 4 } })
    ).toBe('approve');
  });

  it('an already approved artifact offers building it instead', () => {
    const { primary, menu } = selectBandAction({ ...BASE, focusedArtifactStatus: 'approved' });
    expect(primary?.kind).toBe('ask-agent-to-build');
    expect(menu.find((action) => action.kind === 'approve')?.disabledReason).toBe(
      'already-approved'
    );
  });

  it('resolving conflicts outranks every other step', () => {
    expect(
      primaryOf({
        sourceControl: { ...CLEAN, conflictCount: 2, unstagedCount: 5 },
        canMerge: true,
      })
    ).toBe('resolve-conflicts');
  });
});

describe('selectBandAction — invariants', () => {
  it('never offers two primaries: the menu excludes whatever the button is', () => {
    const states: Partial<BandPolicyInput>[] = [
      { sourceControl: { ...CLEAN, unstagedCount: 3 } },
      { sourceControl: { ...CLEAN, publication: 'unpublished', hasPullRequest: false } },
      { sourceControl: { ...CLEAN, aheadCount: 1 } },
      { canMerge: true },
      { prState: 'merged' },
      { focusedArtifactStatus: 'in_review' },
      {},
    ];
    for (const state of states) {
      const { primary, menu } = selectBandAction({ ...BASE, ...state });
      expect(menu.some((action) => action.kind === primary?.kind)).toBe(false);
    }
  });

  it('busy holds everything, including merge and mark done', () => {
    const { primary, menu } = selectBandAction({
      ...BASE,
      sourceControl: { ...CLEAN, busy: true, unstagedCount: 2 },
      canMerge: true,
      prState: 'merged',
    });
    expect(primary).toBeNull();
    expect(menu.every((action) => action.disabledReason === 'busy')).toBe(true);
  });

  it('without a checkout every git step reports why, and none is the button', () => {
    const { primary, menu } = selectBandAction({
      ...BASE,
      sourceControl: { ...CLEAN, hasCheckout: false },
    });
    expect(primary).toBeNull();
    expect(menu.find((action) => action.kind === 'commit')?.disabledReason).toBe('no-checkout');
  });

  it('a work item already done does not offer marking it done again', () => {
    const { primary, menu } = selectBandAction({
      ...BASE,
      prState: 'merged',
      workItemDone: true,
    });
    expect(primary?.kind).not.toBe('mark-done');
    expect(menu.find((action) => action.kind === 'mark-done')?.disabledReason).toBe('already-done');
  });

  it('lists the whole ladder in every state so the menu never changes shape', () => {
    const ladder: BandActionKind[] = [
      'resolve-conflicts',
      'commit',
      'publish',
      'push',
      'create-pr',
      'pull',
      'merge',
      'mark-done',
      'approve',
      'ask-agent-to-build',
    ];
    for (const state of [{}, { canMerge: true }, { focusedArtifactStatus: 'draft' as const }]) {
      const { primary, menu } = selectBandAction({ ...BASE, ...state });
      const kinds = [...menu.map((action) => action.kind), primary?.kind].filter(Boolean);
      expect(new Set(kinds)).toEqual(new Set(ladder));
    }
  });
});
