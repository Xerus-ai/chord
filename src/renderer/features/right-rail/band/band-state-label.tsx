import { useLayoutEffect, useRef, useState } from 'react';
import { fitBandLabel, type BandLabelForm } from './band-label-fit';
import type { BandState } from './band-state';

/**
 * The band's state words, in the form that fits the room left beside the
 * glyph (`fitBandLabel`). Both forms are measured off-screen and the slot is
 * watched, so a rail resize, a roster joining, or a new state re-picks.
 */
export function BandStateLabel({ state }: { state: BandState }) {
  const slotRef = useRef<HTMLSpanElement>(null);
  const fullRef = useRef<HTMLSpanElement>(null);
  const shortRef = useRef<HTMLSpanElement>(null);
  const [form, setForm] = useState<BandLabelForm>('full');

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const full = fullRef.current;
    const short = shortRef.current;
    if (!slot || !full || !short) return;
    const pick = () =>
      setForm(fitBandLabel(slot.clientWidth, { full: full.offsetWidth, short: short.offsetWidth }));
    pick();
    const observer = new ResizeObserver(pick);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [state.text, state.short]);

  return (
    <span ref={slotRef} className="relative min-w-0 flex-1 overflow-hidden whitespace-nowrap">
      {form === 'full' && state.text}
      {form === 'short' && <span className="tabular-nums">{state.short}</span>}
      <span ref={fullRef} aria-hidden className="pointer-events-none invisible absolute left-0">
        {state.text}
      </span>
      <span
        ref={shortRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 tabular-nums"
      >
        {state.short}
      </span>
    </span>
  );
}
