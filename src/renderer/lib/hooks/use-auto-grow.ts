import { useLayoutEffect, type RefObject } from 'react';

/** Roughly eight lines of composer text before the box starts scrolling. */
const DEFAULT_MAX_HEIGHT_PX = 200;

/**
 * Grows a `rows={1}` textarea to fit what has been typed into it, up to
 * `maxHeightPx`, then scrolls inside that height.
 *
 * The height is reset to `auto` first because `scrollHeight` never reports less
 * than the element's current height — measuring without the reset makes the box
 * grow but never shrink when text is deleted.
 *
 * Runs in a layout effect so the resize is committed in the same frame as the
 * keystroke that caused it; a passive effect shows one frame of the old height.
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx: number = DEFAULT_MAX_HEIGHT_PX
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // A hidden box (a retained tab) measures zero; pinning that would keep it
    // collapsed once shown, so leave `auto` and size on the next change.
    if (el.getClientRects().length === 0) return;
    const contentHeight = el.scrollHeight;
    el.style.height = `${Math.min(contentHeight, maxHeightPx)}px`;
    el.style.overflowY = contentHeight > maxHeightPx ? 'auto' : 'hidden';
  }, [ref, value, maxHeightPx]);
}
