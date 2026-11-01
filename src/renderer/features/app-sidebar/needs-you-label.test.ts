import { describe, expect, it } from 'vitest';
import { needsYouLabel } from './needs-you-label';

describe('needsYouLabel', () => {
  it('is null when nothing needs the user', () => {
    expect(needsYouLabel([])).toBeNull();
  });

  it('gives each reason a distinct label', () => {
    const labels = [
      needsYouLabel([{ kind: 'pending_permission', count: 1 }]),
      needsYouLabel([{ kind: 'pending_plan', count: 1 }]),
      needsYouLabel([{ kind: 'review_requested', prUrl: 'https://github.com/a/b/pull/1' }]),
      needsYouLabel([{ kind: 'changes_requested', prUrl: 'https://github.com/a/b/pull/1' }]),
      needsYouLabel([{ kind: 'mentioned', count: 1 }]),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('leads with the first reason and counts the rest', () => {
    expect(
      needsYouLabel([
        { kind: 'review_requested', prUrl: 'https://github.com/a/b/pull/1' },
        { kind: 'mentioned', count: 2 },
      ])
    ).toBe('Review requested +1');
    expect(needsYouLabel([{ kind: 'mentioned', count: 2 }])).toBe('Mentioned you 2×');
  });
});
