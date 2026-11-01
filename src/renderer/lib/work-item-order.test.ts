import { describe, expect, it } from 'vitest';
import type { WorkItemRow } from '@main/db/schema-work-items';
import {
  NO_URGENCY_SIGNALS,
  sortByRecentlyUpdated,
  sortByUrgency,
  urgencyScore,
} from './work-item-order';

/** Only the fields the ordering reads; the rest of the row is irrelevant here. */
function row(id: string, updatedAt: number): WorkItemRow {
  return { id, updatedAt } as WorkItemRow;
}

const names = (items: WorkItemRow[]) => items.map((i) => i.id);

describe('urgencyScore', () => {
  it('ranks a running agent above every pull request state', () => {
    expect(urgencyScore({ pullRequestState: 'changes_requested', isRunning: true })).toBe(3);
    expect(urgencyScore({ pullRequestState: null, isRunning: true })).toBe(3);
  });

  it('ranks work that is blocked on you above work waiting on someone else', () => {
    const blocked = urgencyScore({ pullRequestState: 'changes_requested', isRunning: false });
    const waiting = urgencyScore({ pullRequestState: 'in_review', isRunning: false });
    expect(blocked).toBeGreaterThan(waiting);
    expect(urgencyScore({ pullRequestState: 'conflicts', isRunning: false })).toBe(blocked);
    expect(urgencyScore({ pullRequestState: 'ready_to_merge', isRunning: false })).toBe(waiting);
  });

  it('scores a finished or absent pull request as no urgency', () => {
    expect(urgencyScore(NO_URGENCY_SIGNALS)).toBe(0);
    expect(urgencyScore({ pullRequestState: 'draft', isRunning: false })).toBe(0);
    expect(urgencyScore({ pullRequestState: 'merged', isRunning: false })).toBe(0);
    expect(urgencyScore({ pullRequestState: 'closed', isRunning: false })).toBe(0);
  });
});

describe('sortByUrgency', () => {
  it('puts the most urgent first regardless of when it was touched', () => {
    const stale = row('running-but-stale', 100);
    const fresh = row('idle-but-fresh', 900);

    const sorted = sortByUrgency([fresh, stale], (item) => ({
      pullRequestState: null,
      isRunning: item.id === 'running-but-stale',
    }));

    expect(names(sorted)).toEqual(['running-but-stale', 'idle-but-fresh']);
  });

  it('breaks ties on recency, so an unscored list is ordered newest first', () => {
    const items = [row('old', 100), row('newest', 300), row('middle', 200)];

    const sorted = sortByUrgency(items, () => NO_URGENCY_SIGNALS);

    expect(names(sorted)).toEqual(['newest', 'middle', 'old']);
  });

  it('does not mutate the array it was given', () => {
    const items = [row('a', 100), row('b', 300)];

    sortByUrgency(items, () => NO_URGENCY_SIGNALS);

    expect(names(items)).toEqual(['a', 'b']);
  });
});

describe('sortByRecentlyUpdated', () => {
  it('orders newest first', () => {
    const items = [row('old', 100), row('newest', 300), row('middle', 200)];

    expect(names(sortByRecentlyUpdated(items))).toEqual(['newest', 'middle', 'old']);
  });

  it('does not mutate the array it was given', () => {
    const items = [row('old', 100), row('newest', 300)];

    sortByRecentlyUpdated(items);

    expect(names(items)).toEqual(['old', 'newest']);
  });
});
