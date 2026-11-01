import { useEffect, useState, type RefObject } from 'react';

/**
 * The narrowest a pane can be and still show a side-by-side diff: two ~340px
 * columns, which is the narrowest pair that shows a typical 80-column line
 * without wrapping.
 *
 * This number is Chord's own. Mirrors `--diff-split-min-width` in
 * `styles/tokens.css`.
 */
export const DIFF_SPLIT_MIN_WIDTH = 700;

export interface DiffLayoutMode {
  /** What to actually render. Split only when it is both wanted and possible. */
  renderSideBySide: boolean;
  /** Whether the container is wide enough for split; drives the disabled toggle. */
  canSplit: boolean;
}

/**
 * Resolves the diff's rendered layout from the user's preference and the
 * container's measured width.
 *
 * The preference is kept when the pane is too narrow rather than rewritten, so
 * widening the pane restores split without the user asking twice. Below the
 * threshold the view falls back to unified on its own — a split diff in a
 * 400px pane is two columns of nothing.
 */
export function useDiffLayoutMode(
  containerRef: RefObject<HTMLElement | null>,
  preferSideBySide: boolean
): DiffLayoutMode {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [containerRef]);

  // Width 0 is "not laid out yet", not "too narrow" — honour the preference
  // until a real measurement arrives, so the first paint isn't a flip.
  const canSplit = width === 0 || width >= DIFF_SPLIT_MIN_WIDTH;
  return { renderSideBySide: preferSideBySide && canSplit, canSplit };
}
