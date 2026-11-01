import { describe, expect, it } from 'vitest';
import { describeWorktreeReviewLine } from './worktree-sources-model';

/**
 * The one line per repository that counts the discovered checkouts its
 * worktree sources hide (plan §Phase 3 slice 6): "Review N worktrees",
 * offering Adopt or "Hide for this repo". No line when there is nothing to
 * review.
 */
describe('describeWorktreeReviewLine', () => {
  it('counts one worktree in the singular', () => {
    expect(describeWorktreeReviewLine(1)).toBe('Review 1 worktree');
  });

  it('counts several in the plural', () => {
    expect(describeWorktreeReviewLine(3)).toBe('Review 3 worktrees');
  });

  it('is no line at all when nothing is hidden', () => {
    expect(describeWorktreeReviewLine(0)).toBeNull();
  });
});
