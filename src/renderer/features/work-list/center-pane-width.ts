import type { SplitDirection } from './center-layout';

/**
 * The centre-pane minimum: the width below which a pane stops
 * being a working surface. A side-by-side diff in less than this is the defect
 * this number exists to prevent.
 *
 * Kept in sync with `--pane-min-width` in `styles/tokens.css`, which is what
 * the resizable panels enforce during a drag. This constant is the same policy
 * applied one step earlier — at the moment a split is requested.
 */
export const PANE_MIN_WIDTH = 400;

/**
 * A pane's vertical floor, mirroring `--pane-min-height`.
 *
 * Pane chrome does not scale with the split: the tab strip and the composer
 * dock cost a fixed number of pixels, so a proportional minimum lets a pane
 * shrink until the composer is clipped off the bottom of it.
 */
export const PANE_MIN_HEIGHT = 240;

/**
 * Whether splitting a pane of `paneWidth` can leave both halves usable.
 *
 * Only horizontal splits divide width; a vertical split divides height and
 * leaves each child as wide as the parent, so it is never refused on this
 * ground. A pane that has not been laid out yet reports width 0 — allow it
 * rather than refusing on a measurement that does not exist, since the panel
 * minimums still clamp the result.
 */
export function canSplitPaneWidth(paneWidth: number, direction: SplitDirection): boolean {
  if (direction === 'vertical') return true;
  if (paneWidth <= 0) return true;
  return paneWidth >= PANE_MIN_WIDTH * 2;
}

/** Measures a laid-out pane by the `data-pane-id` its root carries. */
export function measurePaneWidth(paneId: string): number {
  const el = document.querySelector(`[data-pane-id="${CSS.escape(paneId)}"]`);
  return el ? el.getBoundingClientRect().width : 0;
}
