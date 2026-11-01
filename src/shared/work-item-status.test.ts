import { describe, expect, it } from 'vitest';
import {
  compareWorkItemStatusBuckets,
  deriveWorkItemStatus,
  deriveWorktreeStatus,
  WORK_ITEM_STATUS_BUCKETS,
  WORK_ITEM_STATUS_PRIORITY,
  type WorkItemStatusContext,
  type WorktreeBucket,
  type WorktreeStatusInput,
} from './work-item-status';

const baseWorktree: WorktreeStatusInput = {
  pendingPermissionRequests: 0,
  pendingPlanRequests: 0,
  sessionStatuses: ['active'],
  lastTurnErrored: false,
  gitOperationFailed: false,
  isTurnStreaming: false,
  hasUnreadFinishedTurn: false,
};

const baseContext: WorkItemStatusContext = {
  workItemStatus: 'active',
  pullRequest: null,
};

describe('deriveWorktreeStatus', () => {
  it.each<[string, Partial<WorktreeStatusInput>, WorktreeBucket]>([
    ['pending permission request', { pendingPermissionRequests: 1 }, 'needs_input'],
    ['pending plan request', { pendingPlanRequests: 1 }, 'needs_input'],
    ['last turn errored', { lastTurnErrored: true }, 'failed'],
    ['git operation failed', { gitOperationFailed: true }, 'failed'],
    ['session status error', { sessionStatuses: ['error'] }, 'failed'],
    ['turn streaming', { isTurnStreaming: true }, 'working'],
    ['unread finished turn', { hasUnreadFinishedTurn: true }, 'ready_to_review'],
    ['nothing pending', {}, 'idle'],
  ])('%s -> %s', (_name, overrides, expected) => {
    expect(deriveWorktreeStatus({ ...baseWorktree, ...overrides })).toBe(expected);
  });

  it.each<[string, Partial<WorktreeStatusInput>, WorktreeBucket]>([
    // needs_input beats failed
    [
      'needs_input beats failed',
      { pendingPermissionRequests: 1, lastTurnErrored: true },
      'needs_input',
    ],
    // failed beats working
    ['failed beats working', { lastTurnErrored: true, isTurnStreaming: true }, 'failed'],
    // working beats ready_to_review
    [
      'working beats ready_to_review',
      { isTurnStreaming: true, hasUnreadFinishedTurn: true },
      'working',
    ],
    // needs_input beats everything
    [
      'needs_input beats everything',
      {
        pendingPermissionRequests: 1,
        lastTurnErrored: true,
        isTurnStreaming: true,
        hasUnreadFinishedTurn: true,
      },
      'needs_input',
    ],
  ])('priority collision: %s', (_name, overrides, expected) => {
    expect(deriveWorktreeStatus({ ...baseWorktree, ...overrides })).toBe(expected);
  });
});

describe('deriveWorkItemStatus — worktree aggregation', () => {
  it('working on one worktree outranks ready_to_review on another', () => {
    const worktrees: WorktreeBucket[] = ['ready_to_review', 'working'];
    expect(deriveWorkItemStatus(worktrees, baseContext)).toBe('working');
  });

  it('needs_input on one worktree outranks failed on another', () => {
    const worktrees: WorktreeBucket[] = ['failed', 'needs_input'];
    expect(deriveWorkItemStatus(worktrees, baseContext)).toBe('needs_input');
  });

  it('all idle worktrees with no PR yields idle', () => {
    expect(deriveWorkItemStatus(['idle', 'idle'], baseContext)).toBe('idle');
  });

  it('throws for an empty worktree list', () => {
    expect(() => deriveWorkItemStatus([], baseContext)).toThrow();
  });
});

describe('deriveWorkItemStatus — done', () => {
  it('work item status done wins outright', () => {
    const context: WorkItemStatusContext = { workItemStatus: 'done', pullRequest: null };
    expect(deriveWorkItemStatus(['needs_input'], context)).toBe('done');
  });

  it('merged PR wins outright, even over a needs_input worktree', () => {
    const context: WorkItemStatusContext = {
      workItemStatus: 'active',
      pullRequest: {
        status: 'merged',
        isDraft: false,
        reviewDecision: null,
        checksPassing: true,
      },
    };
    expect(deriveWorkItemStatus(['needs_input'], context)).toBe('done');
  });
});

describe('deriveWorkItemStatus — PR-level ready_to_review', () => {
  const readyPr: WorkItemStatusContext['pullRequest'] = {
    status: 'open',
    isDraft: false,
    reviewDecision: null,
    checksPassing: true,
  };

  it('counts when the only worktree is idle', () => {
    const context: WorkItemStatusContext = { workItemStatus: 'active', pullRequest: readyPr };
    expect(deriveWorkItemStatus(['idle'], context)).toBe('ready_to_review');
  });

  it('does not count when a worktree is needs_input', () => {
    const context: WorkItemStatusContext = { workItemStatus: 'active', pullRequest: readyPr };
    expect(deriveWorkItemStatus(['needs_input'], context)).toBe('needs_input');
  });

  it('does not count when a worktree is failed', () => {
    const context: WorkItemStatusContext = { workItemStatus: 'active', pullRequest: readyPr };
    expect(deriveWorkItemStatus(['failed'], context)).toBe('failed');
  });

  it('does not count when a worktree is working', () => {
    const context: WorkItemStatusContext = { workItemStatus: 'active', pullRequest: readyPr };
    expect(deriveWorkItemStatus(['working'], context)).toBe('working');
  });

  it('draft PR does not count as ready', () => {
    const context: WorkItemStatusContext = {
      workItemStatus: 'active',
      pullRequest: { ...readyPr, isDraft: true },
    };
    expect(deriveWorkItemStatus(['idle'], context)).toBe('idle');
  });

  it('changes-requested PR does not count as ready', () => {
    const context: WorkItemStatusContext = {
      workItemStatus: 'active',
      pullRequest: { ...readyPr, reviewDecision: 'CHANGES_REQUESTED' },
    };
    expect(deriveWorkItemStatus(['idle'], context)).toBe('idle');
  });

  it('failing checks do not count as ready', () => {
    const context: WorkItemStatusContext = {
      workItemStatus: 'active',
      pullRequest: { ...readyPr, checksPassing: false },
    };
    expect(deriveWorkItemStatus(['idle'], context)).toBe('idle');
  });

  it('unknown checks status does not count as ready', () => {
    const context: WorkItemStatusContext = {
      workItemStatus: 'active',
      pullRequest: { ...readyPr, checksPassing: null },
    };
    expect(deriveWorkItemStatus(['idle'], context)).toBe('idle');
  });

  it('a worktree already ready_to_review still reports ready even if the PR does not qualify', () => {
    const context: WorkItemStatusContext = { workItemStatus: 'active', pullRequest: null };
    expect(deriveWorkItemStatus(['ready_to_review'], context)).toBe('ready_to_review');
  });
});

describe('compareWorkItemStatusBuckets', () => {
  it('sorts by urgency, most urgent first', () => {
    const shuffled = [...WORK_ITEM_STATUS_BUCKETS].reverse();
    const sorted = [...shuffled].sort(compareWorkItemStatusBuckets);
    expect(sorted).toEqual(['needs_input', 'failed', 'ready_to_review', 'working', 'idle', 'done']);
  });

  it('assigns a unique priority to every bucket', () => {
    const priorities = WORK_ITEM_STATUS_BUCKETS.map((bucket) => WORK_ITEM_STATUS_PRIORITY[bucket]);
    expect(new Set(priorities).size).toBe(WORK_ITEM_STATUS_BUCKETS.length);
  });
});
