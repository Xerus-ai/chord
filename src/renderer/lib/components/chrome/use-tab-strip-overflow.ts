import { useEffect, useRef, useState } from 'react';

interface StripOverflow {
  hasOverflow: boolean;
  canScrollStart: boolean;
  canScrollEnd: boolean;
}

const NO_OVERFLOW: StripOverflow = {
  hasOverflow: false,
  canScrollStart: false,
  canScrollEnd: false,
};

/**
 * Tracks whether a horizontal tab strip overflows and which way it can still
 * scroll. Re-measures on resize, on scroll, and when tabs are added or removed.
 * The strip maps vertical wheel to horizontal scroll.
 */
export function useTabStripOverflow() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<StripOverflow>(NO_OVERFLOW);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      const next: StripOverflow =
        maxScroll <= 1
          ? NO_OVERFLOW
          : {
              hasOverflow: true,
              canScrollStart: el.scrollLeft > 1,
              canScrollEnd: el.scrollLeft < maxScroll - 1,
            };
      setOverflow((prev) =>
        prev.hasOverflow === next.hasOverflow &&
        prev.canScrollStart === next.canScrollStart &&
        prev.canScrollEnd === next.canScrollEnd
          ? prev
          : next
      );
    };

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(el, { childList: true });
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return { ref, overflow };
}
