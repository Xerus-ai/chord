import {
  CHORD_ID_ATTRIBUTE,
  isChordId,
  isPinNumber,
  MAX_PAGE_PINS,
} from '@shared/artifact-frame-constants';
import type { FrameToHostMessage, PagePin } from '@shared/artifact-frame-messages';
import {
  mountRuntimeOverlay,
  mountRuntimeStyle,
  RUNTIME_CHROME_ID_PREFIX,
} from './page-runtime-chrome';

const PIN_SIZE = 20;

const PIN_GAP = 4;

const PINS_CSS = `
#${RUNTIME_CHROME_ID_PREFIX}pins { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
#${RUNTIME_CHROME_ID_PREFIX}pins [data-chord-pin] {
  position: fixed; pointer-events: auto; cursor: pointer; box-sizing: border-box;
  min-width: ${PIN_SIZE}px; height: ${PIN_SIZE}px; padding: 0 5px; margin: 0;
  border: 0; border-radius: 999px 999px 999px 2px;
  background: var(--status-warn); color: var(--surface);
  font: 700 11px/${PIN_SIZE}px var(--font-sans); text-align: center; box-shadow: var(--shadow-sm);
}
#${RUNTIME_CHROME_ID_PREFIX}pins [data-chord-pin][data-selected] {
  outline: 2px solid var(--focus-ring); outline-offset: 1px;
}
`;

/**
 * The frame's own check of a `chord:set-pins` payload: zod is not bundled in
 * the runtime (chord-page.ts), so this mirrors `pagePinSchema`.
 */
export function isSetPinsPayload(pins: unknown, selected: unknown): pins is PagePin[] {
  if (!Array.isArray(pins) || pins.length > MAX_PAGE_PINS) return false;
  if (selected !== null && !isPinNumber(selected)) return false;
  return pins.every(
    (pin: unknown) =>
      typeof pin === 'object' &&
      pin !== null &&
      isPinNumber((pin as Record<string, unknown>).n) &&
      isChordId((pin as Record<string, unknown>).chordId)
  );
}

function elementFor(chordId: string): Element | null {
  return document.querySelector(`[${CHORD_ID_ATTRIBUTE}="${chordId}"]`);
}

/**
 * Numbered comment pins (shared-items step 1, S6). Each pin sits at the top
 * left of the stamped element its thread is on and follows it through
 * scrolling, resizing, loads and script-driven DOM changes. A pin whose element
 * is not in the page (a script has not built it, or it was removed) is not
 * drawn. Clicking a pin tells the host which thread to select; selecting a
 * thread in the host scrolls its element into view.
 *
 * Pins are runtime chrome, so the element picker never offers or swallows
 * them (page-element-picker.ts).
 */
export function createCommentPins(post: (message: FrameToHostMessage) => void) {
  let style: HTMLStyleElement | null = null;
  let layer: HTMLDivElement | null = null;
  let pins: PagePin[] = [];
  let selected: number | null = null;
  let frameRequest: number | null = null;
  let mutationObserver: MutationObserver | null = null;

  function place(): void {
    frameRequest = null;
    if (!layer) return;
    for (const button of layer.querySelectorAll<HTMLButtonElement>('[data-chord-pin]')) {
      const element = elementFor(button.dataset.chordPinId ?? '');
      const rect = element?.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        button.style.display = 'none';
        continue;
      }
      button.style.display = 'block';
      // Beside the element's first line when the page leaves room, else just
      // above its top-left corner, so the pin never covers what it is about.
      const beside = rect.left >= PIN_SIZE + PIN_GAP * 2;
      button.style.left = `${beside ? rect.left - PIN_SIZE - PIN_GAP : Math.max(0, rect.left - PIN_GAP)}px`;
      button.style.top = `${beside ? rect.top : Math.max(0, rect.top - PIN_SIZE + 2)}px`;
    }
  }

  const schedulePlace = () => {
    if (frameRequest === null) frameRequest = requestAnimationFrame(place);
  };

  function mount(): HTMLDivElement {
    if (layer) return layer;
    style = mountRuntimeStyle('pins', PINS_CSS);
    layer = mountRuntimeOverlay('pins');
    window.addEventListener('scroll', schedulePlace, { capture: true, passive: true });
    window.addEventListener('resize', schedulePlace);
    // An image or font arriving moves everything under it; `load` does not
    // bubble, so it is caught on the way down.
    window.addEventListener('load', schedulePlace, true);
    // A script can build, move or restyle a pinned element at any time. The
    // pins' own restyling is not a page change, or placing would loop.
    mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !layer?.contains(record.target))) schedulePlace();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    return layer;
  }

  function clear(): void {
    pins = [];
    selected = null;
    if (!layer) return;
    window.removeEventListener('scroll', schedulePlace, { capture: true });
    window.removeEventListener('resize', schedulePlace);
    window.removeEventListener('load', schedulePlace, true);
    mutationObserver?.disconnect();
    mutationObserver = null;
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null;
    layer.remove();
    style?.remove();
    layer = null;
    style = null;
  }

  function drawPin(pin: PagePin): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(pin.n);
    button.dataset.chordPin = String(pin.n);
    button.dataset.chordPinId = pin.chordId;
    button.title = `Comment ${pin.n}`;
    if (pin.n === selected) button.setAttribute('data-selected', '');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      post({ type: 'chord:pin-selected', n: pin.n });
    });
    return button;
  }

  function setPins(next: PagePin[], nextSelected: number | null): void {
    const selectionChanged = nextSelected !== selected;
    const drawn = next.filter((pin) => elementFor(pin.chordId) !== null);
    if (drawn.length === 0) {
      clear();
      return;
    }
    pins = drawn;
    selected = nextSelected;
    const target = mount();
    target.replaceChildren(...pins.map(drawPin));
    place();
    const selectedPin = pins.find((pin) => pin.n === selected);
    if (selectionChanged && selectedPin) {
      elementFor(selectedPin.chordId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  return { setPins, clear };
}
