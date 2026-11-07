import { describe, expect, it } from 'vitest';
import type { Worktree } from '@shared/worktrees';
import { shouldShowWorktreePill, worktreePillLabel } from './worktree-pill';

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'wt-1',
    workItemId: 'item-1',
    path: 'C:/repo',
    branchName: 'chord/raghav-a40',
    baseBranch: 'main',
    targetRef: null,
    setupStatus: null,
    forkSource: null,
    checkoutOrigin: 'chord',
    companionPath: null,
    isPrimary: true,
    title: null,
    createdAt: 0,
    archivedAt: null,
    ...overrides,
  };
}

describe('shouldShowWorktreePill', () => {
  it('hides for zero or one worktree', () => {
    expect(shouldShowWorktreePill(undefined)).toBe(false);
    expect(shouldShowWorktreePill([])).toBe(false);
    expect(shouldShowWorktreePill([makeWorktree()])).toBe(false);
  });

  it('shows once a work item has more than one worktree', () => {
    expect(shouldShowWorktreePill([makeWorktree(), makeWorktree({ id: 'wt-2' })])).toBe(true);
  });
});

describe('worktreePillLabel', () => {
  it('reads the branch name when present', () => {
    expect(worktreePillLabel(makeWorktree({ branchName: 'chord/raghav-a40' }))).toBe(
      'chord/raghav-a40'
    );
  });

  it('falls back to the title when the branch is not yet created', () => {
    expect(worktreePillLabel(makeWorktree({ branchName: null, title: 'Fix login bug' }))).toBe(
      'Fix login bug'
    );
  });

  it('falls back to the id when neither branch nor title exist', () => {
    expect(worktreePillLabel(makeWorktree({ branchName: null, title: null, id: 'wt-9' }))).toBe(
      'wt-9'
    );
  });

  it('shows a generic label when there is no current worktree', () => {
    expect(worktreePillLabel(undefined)).toBe('Worktree');
  });
});
