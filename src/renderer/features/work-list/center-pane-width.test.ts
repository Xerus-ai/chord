import { describe, expect, it } from 'vitest';
import { canSplitPaneWidth, PANE_MIN_WIDTH } from './center-pane-width';

describe('canSplitPaneWidth', () => {
  it('refuses a horizontal split that cannot give both halves the minimum', () => {
    expect(canSplitPaneWidth(PANE_MIN_WIDTH * 2 - 1, 'horizontal')).toBe(false);
  });

  it('allows a horizontal split at exactly twice the minimum', () => {
    expect(canSplitPaneWidth(PANE_MIN_WIDTH * 2, 'horizontal')).toBe(true);
  });

  it('refuses the width that produced the original defect', () => {
    // The measured centre pane at a 1386px window with the right panel open.
    expect(canSplitPaneWidth(414, 'horizontal')).toBe(false);
  });

  it('never refuses a vertical split, which divides height and not width', () => {
    expect(canSplitPaneWidth(1, 'vertical')).toBe(true);
  });

  it('allows a split when the pane has not been laid out yet', () => {
    // Width 0 means "no measurement", not "too narrow". The panel minimums
    // still clamp the result, so refusing here would block a legitimate split.
    expect(canSplitPaneWidth(0, 'horizontal')).toBe(true);
  });
});
