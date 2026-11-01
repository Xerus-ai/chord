/**
 * Elements the runtime adds to a page for its own UI (the pick highlight, the
 * "ask the agent" hint, injected styles). They share an id prefix so the
 * picker never offers them and the editor never stamps or edits them.
 */
export const RUNTIME_CHROME_ID_PREFIX = 'chord-runtime-';

export function isRuntimeChrome(element: Element): boolean {
  return element.closest(`[id^="${RUNTIME_CHROME_ID_PREFIX}"]`) !== null;
}

/** Adds a `<style>` owned by the runtime; the page CSP allows inline styles. */
export function mountRuntimeStyle(name: string, css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = `${RUNTIME_CHROME_ID_PREFIX}${name}-style`;
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

/** A fixed-position box above the page that never takes pointer events. */
export function mountRuntimeOverlay(name: string): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = `${RUNTIME_CHROME_ID_PREFIX}${name}`;
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  return overlay;
}

export function placeOverlay(overlay: HTMLElement, rect: DOMRect): void {
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.display = 'block';
}
