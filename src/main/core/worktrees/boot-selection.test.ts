import { describe, expect, it } from 'vitest';
import { selectBootWorktrees, type BootWorktreeCandidate } from './boot-selection';

function candidate(overrides: Partial<BootWorktreeCandidate>): BootWorktreeCandidate {
  return {
    worktreeId: 'wt-1',
    workItemId: 'wi-1',
    path: '/repo/worktree',
    archivedAt: null,
    workItemStatus: 'active',
    provisionStatus: 'ready',
    ...overrides,
  };
}

describe('selectBootWorktrees', () => {
  it('includes a non-archived worktree of an active work item', () => {
    const result = selectBootWorktrees([candidate({})]);
    expect(result).toHaveLength(1);
  });

  it('excludes an archived worktree even on an active work item', () => {
    const result = selectBootWorktrees([candidate({ archivedAt: 1_700_000_000 })]);
    expect(result).toHaveLength(0);
  });

  it('excludes a worktree whose work item is not active', () => {
    const result = selectBootWorktrees([candidate({ workItemStatus: 'archived' })]);
    expect(result).toHaveLength(0);
  });

  it('excludes a worktree that is both archived and on an inactive work item', () => {
    const result = selectBootWorktrees([
      candidate({ archivedAt: 1_700_000_000, workItemStatus: 'done' }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('filters a mixed set down to only eligible rows', () => {
    const rows = [
      candidate({ worktreeId: 'a' }),
      candidate({ worktreeId: 'b', archivedAt: 1_700_000_000 }),
      candidate({ worktreeId: 'c', workItemStatus: 'paused' }),
      candidate({ worktreeId: 'd' }),
    ];
    const result = selectBootWorktrees(rows);
    expect(result.map((r) => r.worktreeId)).toEqual(['a', 'd']);
  });

  it('excludes a work item still provisioning or failed (primary is the repo root)', () => {
    const result = selectBootWorktrees([
      candidate({ worktreeId: 'p', provisionStatus: 'provisioning' }),
      candidate({ worktreeId: 'f', provisionStatus: 'failed' }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('returns an empty array for no candidates', () => {
    expect(selectBootWorktrees([])).toEqual([]);
  });
});
