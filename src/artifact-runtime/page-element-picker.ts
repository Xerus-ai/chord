import {
  CHORD_ID_ATTRIBUTE,
  CHORD_SOURCE_ATTRIBUTE,
  isChordId,
  isChordSourceLocation,
  MAX_PICKED_HTML_LENGTH,
  MAX_PICKED_SELECTOR_LENGTH,
  MAX_PICKED_SOURCE_LOCATION_LENGTH,
  MAX_PICKED_TEXT_LENGTH,
} from '@shared/artifact-frame-constants';
import type { FrameToHostMessage, PickedElement } from '@shared/artifact-frame-messages';
import {
  isRuntimeChrome,
  mountRuntimeOverlay,
  mountRuntimeStyle,
  placeOverlay,
  RUNTIME_CHROME_ID_PREFIX,
} from './page-runtime-chrome';

const PICK_CSS = `
#${RUNTIME_CHROME_ID_PREFIX}pick-highlight {
  position: fixed; z-index: 2147483647; pointer-events: none; display: none;
  outline: 2px solid var(--selected-border); outline-offset: 1px;
  background: var(--selection-bg); border-radius: var(--radius-xs);
}
html.${RUNTIME_CHROME_ID_PREFIX}picking, html.${RUNTIME_CHROME_ID_PREFIX}picking * { cursor: crosshair !important; }
`;

const MIN_PICKABLE_SIZE = 4;
const SIMPLE_ID = /^[A-Za-z][\w-]*$/;

function isPickable(target: EventTarget | null): target is Element {
  if (!(target instanceof Element)) return false;
  if (target === document.documentElement || target === document.body) return false;
  if (isRuntimeChrome(target)) return false;
  const rect = target.getBoundingClientRect();
  return rect.width >= MIN_PICKABLE_SIZE && rect.height >= MIN_PICKABLE_SIZE;
}

/**
 * A CSS path for an element without a stamped id — script-built content, or
 * any element of a prototype. Stops early at a unique `id`; otherwise it is
 * anchored at `body >`, so `div` never means every div in the page. When the
 * path is too long to send whole, the most specific tail is kept and the
 * anchor goes with the rest (describePickedElementForAgent says so).
 */
function selectorFor(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  let anchored = false;
  while (node && node !== document.body && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    if (
      node.id &&
      SIMPLE_ID.test(node.id) &&
      document.querySelectorAll(`#${node.id}`).length === 1
    ) {
      parts.unshift(`${tag}#${node.id}`);
      anchored = true;
      break;
    }
    const parent: Element | null = node.parentElement;
    const sameTag = parent
      ? [...parent.children].filter((child) => child.tagName === node!.tagName)
      : [];
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    node = parent;
  }
  if (!anchored && node === document.body) parts.unshift('body');
  let selector = parts.join(' > ') || element.tagName.toLowerCase();
  // Keep the most specific end of an over-long path.
  while (selector.length > MAX_PICKED_SELECTOR_LENGTH && parts.length > 1) {
    parts.shift();
    selector = parts.join(' > ');
  }
  return selector.slice(-MAX_PICKED_SELECTOR_LENGTH);
}

/** The compile-time source stamp on the element itself, else the nearest ancestor's. */
function sourceLocationOf(
  element: Element
): Pick<PickedElement, 'sourceLocation' | 'sourceLocationOf'> {
  const stamped = element.closest(`[${CHORD_SOURCE_ATTRIBUTE}]`);
  const location = stamped?.getAttribute(CHORD_SOURCE_ATTRIBUTE);
  if (!stamped || !isChordSourceLocation(location)) {
    return { sourceLocation: null, sourceLocationOf: null };
  }
  return {
    sourceLocation: location.slice(0, MAX_PICKED_SOURCE_LOCATION_LENGTH),
    sourceLocationOf: stamped === element ? 'element' : 'ancestor',
  };
}

function describeElement(element: Element): PickedElement {
  const rect = element.getBoundingClientRect();
  const chordId = element.getAttribute(CHORD_ID_ATTRIBUTE);
  return {
    chordId: isChordId(chordId) ? chordId : null,
    selector: selectorFor(element),
    ...sourceLocationOf(element),
    tagName: element.tagName.toLowerCase().slice(0, 64),
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PICKED_TEXT_LENGTH),
    html: element.outerHTML.slice(0, MAX_PICKED_HTML_LENGTH),
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
  };
}

/**
 * Pick an element for the agent (plan 2026-09-23 P1b step 3). While armed,
 * hovering outlines the element under the pointer and a click picks it
 * instead of reaching the page — a prototype's button is chosen, not
 * pressed. A pick locks the picker (the outline stays on the chosen element)
 * until the host re-arms it, so a second click cannot replace the element
 * the user is describing.
 */
export function createElementPicker(post: (message: FrameToHostMessage) => void) {
  let style: HTMLStyleElement | null = null;
  let highlight: HTMLDivElement | null = null;
  let armed = false;
  let hovered: Element | null = null;

  // The runtime's own controls (comment pins) keep working while picking.
  const isChromeEvent = (event: Event) =>
    event.target instanceof Element && isRuntimeChrome(event.target);

  const swallow = (event: Event) => {
    if (!armed || isChromeEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onMove = (event: MouseEvent) => {
    if (!armed || !highlight) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!isPickable(target) || target === hovered) return;
    hovered = target;
    placeOverlay(highlight, target.getBoundingClientRect());
  };

  const onClick = (event: MouseEvent) => {
    if (!armed || isChromeEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = isPickable(event.target) ? event.target : hovered;
    if (!target || !highlight) return;
    armed = false;
    document.documentElement.classList.remove(`${RUNTIME_CHROME_ID_PREFIX}picking`);
    placeOverlay(highlight, target.getBoundingClientRect());
    post({ type: 'chord:element-picked', element: describeElement(target) });
  };

  function arm(): void {
    if (!style) {
      style = mountRuntimeStyle('pick', PICK_CSS);
      highlight = mountRuntimeOverlay('pick-highlight');
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('mousedown', swallow, true);
      document.addEventListener('mouseup', swallow, true);
      document.addEventListener('pointerdown', swallow, true);
      document.addEventListener('pointerup', swallow, true);
    }
    armed = true;
    hovered = null;
    if (highlight) highlight.style.display = 'none';
    document.documentElement.classList.add(`${RUNTIME_CHROME_ID_PREFIX}picking`);
  }

  function disarm(): void {
    armed = false;
    hovered = null;
    document.documentElement.classList.remove(`${RUNTIME_CHROME_ID_PREFIX}picking`);
    if (!style) return;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', swallow, true);
    document.removeEventListener('mouseup', swallow, true);
    document.removeEventListener('pointerdown', swallow, true);
    document.removeEventListener('pointerup', swallow, true);
    style.remove();
    style = null;
    highlight?.remove();
    highlight = null;
  }

  return { arm, disarm };
}
