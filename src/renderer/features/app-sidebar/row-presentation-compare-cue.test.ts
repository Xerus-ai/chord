import { describe, expect, it } from 'vitest';
import type { SidebarSummary, SidebarWorktreeSummary } from '@shared/sidebar-summaries';
import { getTrailingSlot, resolveItemCompareCue } from './row-presentation';
import type { SidebarItem } from './sidebar-projection';

function makeItem(overrides: Partial<SidebarItem> = {}): SidebarItem {
  return {
    id: 'wi-1',
    name: 'Chord e2e git settings',
    repoId: 'repo-a',
    repoLabel: 'git-settings',
    branchName: 'chord/git-settings',
    bucket: 'idle',
    updatedAt: 1_800_000_000,
    createdAt: 1_799_000_000,
    ownership: 'mine',
    owner: null,
    sharedArtifacts: null,
    diffStats: null,
    pullRequestUrl: null,
    pullRequest: null,
    providerId: null,
    devServerUrl: null,
    worktreeCount: 1,
    liveSessionCount: 0,
    needsYou: [],
    unread: false,
    provisionStatus: 'ready',
    ownedByAnotherAccount: false,
    repoHint: null,
    compareCue: null,
    ...overrides,
  };
}

function makeWorktree(overrides: Partial<SidebarWorktreeSummary> = {}): SidebarWorktreeSummary {
  return {
    id: 'wt-1',
    branch: 'chord/git-settings',
    targetRef: 'origin/main',
    title: null,
    isPrimary: true,
    diffStats: null,
    compareBase: { kind: 'no_upstream', branch: 'chord/git-settings' },
    providerId: null,
    bucket: 'idle',
    liveSessions: [],
    ...overrides,
  };
}

function makeSummary(worktrees: SidebarWorktreeSummary[]): SidebarSummary {
  return {
    id: 'wi-1',
    diffStats: null,
    pullRequest: null,
    sessionCount: 0,
    aggregateBucket: 'idle',
    worktrees,
    needsYou: [],
    description: null,
    devServerUrl: null,
    checkoutBranch: 'chord/git-settings',
    lastFinishedTurnAt: null,
    archivedLaneCount: 0,
  };
}

/**
 * devstation-ama: with Compare base = upstream on a branch that has none, a
 * single-lane item's row showed no count and no reason — its time stood where
 * the +/− would be, and only the expanded sub-row said "no upstream"
 * (`work-item-subrows.tsx`). The item row carries the same cue when its one
 * lane cannot be counted.
 */
describe('resolveItemCompareCue', () => {
  it('has nothing to say before the summary arrives', () => {
    expect(resolveItemCompareCue(undefined)).toBeNull();
  });

  it("is the one lane's no_upstream when that lane cannot be counted", () => {
    expect(resolveItemCompareCue(makeSummary([makeWorktree()]))).toEqual({
      kind: 'no_upstream',
      branch: 'chord/git-settings',
    });
  });

  it("is the one lane's unreadable state, with its reason", () => {
    const message = 'The checkout folder C:/lanes/x is missing.';
    expect(
      resolveItemCompareCue(
        makeSummary([makeWorktree({ compareBase: { kind: 'unreadable', message } })])
      )
    ).toEqual({ kind: 'unreadable', message });
  });

  it('is nothing for a lane counted against a ref', () => {
    expect(
      resolveItemCompareCue(
        makeSummary([
          makeWorktree({
            compareBase: { kind: 'ref', mode: 'upstream', ref: 'origin/chord/git-settings' },
            diffStats: { added: 5, removed: 0 },
          }),
        ])
      )
    ).toBeNull();
  });

  it("is nothing when another lane still counts: that lane's sub-row says which", () => {
    expect(
      resolveItemCompareCue(
        makeSummary([
          makeWorktree(),
          makeWorktree({
            id: 'wt-2',
            isPrimary: false,
            compareBase: { kind: 'ref', mode: 'upstream', ref: 'origin/chord/second' },
            diffStats: { added: 2, removed: 1 },
          }),
        ])
      )
    ).toBeNull();
  });
});

describe('getTrailingSlot — an uncountable lane', () => {
  it('puts the reason where the count would be, not the time', () => {
    const cue = { kind: 'no_upstream', branch: 'chord/git-settings' } as const;
    expect(getTrailingSlot(makeItem({ compareCue: cue }))).toEqual({ kind: 'compare_cue', cue });
  });

  it('still shows a working item as running', () => {
    const cue = { kind: 'no_upstream', branch: 'chord/git-settings' } as const;
    expect(
      getTrailingSlot(makeItem({ bucket: 'working', liveSessionCount: 1, compareCue: cue }))
    ).toEqual({ kind: 'running', liveSessionCount: 1 });
  });

  it('keeps the time for a countable item with nothing changed', () => {
    expect(getTrailingSlot(makeItem())).toEqual({ kind: 'time' });
  });
});
