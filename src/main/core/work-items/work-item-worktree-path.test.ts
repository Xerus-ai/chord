import { describe, expect, it } from 'vitest';
import { pickWorktreePath } from './work-item-worktree-path';

const workItem = { id: 'wi-1', repoPath: '/pool/wi-1' };

function worktree(
  overrides: Partial<{ id: string; workItemId: string; archivedAt: number | null }> = {}
) {
  return {
    id: 'wt-2',
    workItemId: 'wi-1',
    path: '/pool/wi-1--review',
    archivedAt: null,
    ...overrides,
  };
}

describe('pickWorktreePath', () => {
  it('uses the work item repo path when no worktree is requested', () => {
    expect(pickWorktreePath(workItem, undefined, undefined)).toEqual({
      success: true,
      data: '/pool/wi-1',
    });
  });

  it('uses the requested worktree path when it belongs to the work item', () => {
    expect(pickWorktreePath(workItem, 'wt-2', worktree())).toEqual({
      success: true,
      data: '/pool/wi-1--review',
    });
  });

  it('refuses a worktree id with no row', () => {
    expect(pickWorktreePath(workItem, 'wt-2', undefined)).toEqual({
      success: false,
      error: { type: 'worktree_not_found', worktreeId: 'wt-2' },
    });
  });

  it('refuses a worktree owned by another work item', () => {
    expect(pickWorktreePath(workItem, 'wt-2', worktree({ workItemId: 'wi-other' }))).toEqual({
      success: false,
      error: { type: 'worktree_not_found', worktreeId: 'wt-2' },
    });
  });

  it('refuses a row whose id does not match the requested worktree', () => {
    expect(pickWorktreePath(workItem, 'wt-2', worktree({ id: 'wt-3' }))).toEqual({
      success: false,
      error: { type: 'worktree_not_found', worktreeId: 'wt-2' },
    });
  });

  it('refuses an archived worktree', () => {
    expect(pickWorktreePath(workItem, 'wt-2', worktree({ archivedAt: 1_700_000_000 }))).toEqual({
      success: false,
      error: { type: 'worktree_archived', worktreeId: 'wt-2' },
    });
  });
});
