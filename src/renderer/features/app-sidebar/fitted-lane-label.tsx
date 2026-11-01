import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import { fitLaneLabel, type LaneLabelFit } from './fit-lane-label';

const PART = 'inline-block overflow-hidden text-ellipsis align-bottom';
const MAX_TAIL_LENGTH = 12;

let measureContext: CanvasRenderingContext2D | null = null;

/** A string's rendered width in `element`'s font, letter spacing included. */
function createTextMeasure(element: HTMLElement): (text: string) => number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) throw new Error('No 2D canvas to measure the lane label with');
  const context = measureContext;
  const style = getComputedStyle(element);
  return (text) => {
    context.font = style.font;
    context.letterSpacing = style.letterSpacing;
    return Math.ceil(context.measureText(text).width);
  };
}

/**
 * A lane row's "title branch → target", each part given the width
 * `fitLaneLabel` plans. One inline line, never flex items: Chrome's innerText
 * breaks a line between flex items, and the row must read "branch → target"
 * whole (left-rail-lanes.mjs). The root takes the row's free width (`flex-1`,
 * zero basis), so measuring it never feeds back into its own size.
 */
export function FittedLaneLabel({
  title,
  branch,
  suffix,
  tooltip,
}: {
  title: string | null;
  branch: string;
  suffix: string | null;
  tooltip: string;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<LaneLabelFit | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const refit = () =>
      setFit(
        fitLaneLabel({
          available: root.clientWidth,
          title,
          branch,
          suffix,
          measure: createTextMeasure(root),
        })
      );
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(root);
    // A web font landing after the first fit changes every width.
    document.fonts.addEventListener('loadingdone', refit);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', refit);
    };
  }, [title, branch, suffix]);

  const tailLength = fit?.tailLength ?? Math.min(MAX_TAIL_LENGTH, branch.length);
  const head = branch.slice(0, branch.length - tailLength);
  const tail = branch.slice(branch.length - tailLength);
  const width = (px: number | undefined) => (px === undefined ? undefined : { maxWidth: px });
  const showTitle = title !== null && (fit === null || fit.titleWidth > 0);

  return (
    <span
      ref={rootRef}
      title={tooltip}
      className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap"
    >
      {showTitle && (
        <>
          <span className={PART} style={width(fit?.titleWidth)}>
            {title}
          </span>{' '}
        </>
      )}
      <span className={cn(PART, title && 'text-text-passive')} style={width(fit?.headWidth)}>
        {head}
      </span>
      <span className={cn(PART, title && 'text-text-passive')}>{tail}</span>
      {suffix && (
        // `pre`: under `nowrap` the space opening " → target" would be
        // dropped at the start of its box, and innerText would read "c58→".
        <span
          className={cn(PART, 'whitespace-pre text-text-passive')}
          style={width(fit?.suffixWidth)}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
