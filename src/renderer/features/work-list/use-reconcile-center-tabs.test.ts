import { describe, expect, it } from 'vitest';
import { artifactPathTab, filePathTab, type DocumentTab } from './center-tab';
import { isTabOnRemovedWorktree } from './use-reconcile-center-tabs';

const fileIn = (worktreeId?: string): DocumentTab =>
  filePathTab('a.ts', worktreeId ? { worktreeId } : {});
const live = new Set(['wt-primary']);

describe('isTabOnRemovedWorktree', () => {
  it('keeps tabs with no worktree, artifacts, and live worktrees', () => {
    expect(isTabOnRemovedWorktree(fileIn(), live, null)).toBe(false);
    expect(isTabOnRemovedWorktree(artifactPathTab('x', 'x'), live, null)).toBe(false);
    expect(isTabOnRemovedWorktree(fileIn('wt-primary'), live, null)).toBe(false);
  });

  it('drops a restored tab whose worktree is not in the first list', () => {
    expect(isTabOnRemovedWorktree(fileIn('wt-gone'), live, null)).toBe(true);
    expect(
      isTabOnRemovedWorktree({ kind: 'commit', worktreeId: 'wt-gone', sha: 'abc' }, live, null)
    ).toBe(true);
  });

  it('later drops only worktrees that left the previous list', () => {
    const previous = new Set(['wt-primary', 'wt-archived']);
    expect(isTabOnRemovedWorktree(fileIn('wt-archived'), live, previous)).toBe(true);
    // Newer than the cached list: not judged until a list has seen it.
    expect(isTabOnRemovedWorktree(fileIn('wt-new'), live, previous)).toBe(false);
  });
});
