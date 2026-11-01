import { useLayoutEffect, useRef, useState } from 'react';
import { splitMiddleTruncation } from '@renderer/lib/middle-truncation';
import { cn } from '@renderer/utils/utils';

/**
 * A name that, when it doesn't fit, loses its middle rather than its end:
 * `raghav/chord-e2…c19--second` instead of `raghav/chord-e2e-lan…`. The head
 * takes the ellipsis; the tail (`splitMiddleTruncation`) always shows, as far
 * as the row has room. A sidebar lane row, which also carries a title and a
 * "→ target", fits its parts itself (`app-sidebar/fitted-lane-label.tsx`).
 *
 * Inline boxes, not flex items: Chrome's innerText breaks a line between flex
 * items, and the name must read whole — to the user's copy and to the e2e
 * checks. The head's width is the row less the measured tail, since a
 * proportional font's `ch` is no measure of it.
 */
export function MiddleTruncate({
  text,
  title,
  className,
}: {
  text: string;
  title?: string;
  className?: string;
}) {
  const { head, tail } = splitMiddleTruncation(text);
  const tailRef = useRef<HTMLSpanElement>(null);
  const [tailWidth, setTailWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const end = tailRef.current;
    if (!end) return;
    const measure = () => setTailWidth(end.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      className={cn('block min-w-0 overflow-hidden whitespace-nowrap', className)}
      title={title ?? text}
    >
      <span
        className="inline-block truncate align-bottom"
        style={tailWidth === null ? undefined : { maxWidth: `calc(100% - ${tailWidth}px)` }}
      >
        {head}
      </span>
      <span ref={tailRef} className="inline-block max-w-full truncate align-bottom">
        {tail}
      </span>
    </span>
  );
}
