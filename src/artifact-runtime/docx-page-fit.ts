/**
 * Fits the pages docx-preview rendered to the frame they are shown in
 * (devstation-5e8). docx-preview lays each page out at its paper width
 * (`section.docx` gets `style.width` from the document's `pgSz`; a Letter page
 * is 612pt = 816px) inside a wrapper with 30px of padding, so a frame
 * narrower than that scrolled sideways. The wrapper is scaled down with CSS
 * `zoom` — layout scales with it, so nothing overflows and no blank space is
 * left below — and never scaled up: a page that fits keeps its size.
 */

const PX_PER_PT = 96 / 72;
const PAGE_SELECTOR = 'section.docx';

/** The zoom that fits `contentWidth` CSS px into `frameWidth` CSS px, at most 1. */
export function computeDocxZoom(frameWidth: number, contentWidth: number): number {
  if (!(frameWidth > 0)) throw new Error(`docx view: invalid frame width ${frameWidth}`);
  if (!(contentWidth > 0)) throw new Error(`docx view: invalid page width ${contentWidth}`);
  return Math.min(1, frameWidth / contentWidth);
}

/** The width docx-preview wrote on a page, in CSS px (`pt` or `px`). */
function pageWidthPx(page: HTMLElement): number {
  const width = page.style.width;
  const match = /^([\d.]+)(pt|px)$/.exec(width);
  if (!match) throw new Error(`docx view: page has no usable width (${JSON.stringify(width)})`);
  const value = Number(match[1]);
  return match[2] === 'pt' ? value * PX_PER_PT : value;
}

function horizontalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
}

/**
 * Scales `wrapper` (docx-preview's `.docx-wrapper`) so its widest page plus
 * the wrapper's padding fits `frameWidth`. Measured from the unscaled pages
 * each time, so a frame that grows back gets the page at full size again.
 * Returns the zoom applied.
 */
export function fitDocxPagesToFrame(wrapper: HTMLElement, frameWidth: number): number {
  if (frameWidth === 0) throw new Error('docx view: the frame has no width yet');
  const pages = Array.from(wrapper.querySelectorAll<HTMLElement>(PAGE_SELECTOR));
  if (pages.length === 0) throw new Error('docx view: no pages to fit');
  wrapper.style.removeProperty('zoom');
  const widest = Math.max(...pages.map(pageWidthPx));
  const zoom = computeDocxZoom(frameWidth, widest + horizontalPadding(wrapper));
  wrapper.style.setProperty('zoom', String(zoom));
  return zoom;
}

/**
 * Fits when the frame has a width. A width of 0 is a frame not laid out yet
 * (a tab still mounting when the render finished — seen in the sharing e2e,
 * sidebar check 17b): nothing to fit against, and the frame's `resize` fires
 * once it is. Returns null in that case, the zoom otherwise.
 */
export function fitDocxPagesWhenLaidOut(wrapper: HTMLElement, frameWidth: number): number | null {
  if (frameWidth === 0) return null;
  return fitDocxPagesToFrame(wrapper, frameWidth);
}
