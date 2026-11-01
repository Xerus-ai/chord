import { describe, expect, it } from 'vitest';
import type { WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { validateSessionWorktree } from './session-worktree';

function makeRow(overrides: Partial<WorkItemWorktreeRow> = {}): WorkItemWorktreeRow {
  return {
    id: 'wt-1',
    workItemId: 'item-1',
    path: 'C:\\repo\\item-1',
    branchName: 'feature',
    baseBranch: 'main',
    targetRef: null,
    forkSha: null,
    slug: null,
    branchOrigin: null,
    setupStatus: null,
    setupLogPath: null,
    approvedScriptsHash: null,
    approvedScripts: null,
    portBase: null,
    forkSource: null,
    checkoutOrigin: 'chord',
    isPrimary: 0,
    title: null,
    createdAt: 0,
    archivedAt: null,
    gitLastError: null,
    gitLastErrorAt: null,
    ...overrides,
  };
}

describe('validateSessionWorktree', () => {
  it('accepts a worktree that belongs to the work item and is not archived', () => {
    const row = makeRow();
    const result = validateSessionWorktree(row, 'item-1');
    expect(result).toEqual({ success: true, data: row });
  });

  it('rejects a missing worktree row', () => {
    const result = validateSessionWorktree(undefined, 'item-1');
    expect(result).toEqual({ success: false, error: { type: 'worktree_not_found' } });
  });

  it('rejects a worktree that belongs to a different work item', () => {
    const row = makeRow({ workItemId: 'item-2' });
    const result = validateSessionWorktree(row, 'item-1');
    expect(result).toEqual({ success: false, error: { type: 'worktree_not_found' } });
  });

  it('rejects an archived worktree', () => {
    const row = makeRow({ archivedAt: 1700000000 });
    const result = validateSessionWorktree(row, 'item-1');
    expect(result).toEqual({ success: false, error: { type: 'worktree_archived' } });
  });
});
