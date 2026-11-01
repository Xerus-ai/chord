/**
 * Standalone terminal dimension measurement utility.
 *
 * Extracted from FitAddon.proposeDimensions() but decoupled from any specific
 * terminal instance — accepts a container element and cell metrics directly.
 */
import type { Terminal } from '@xterm/xterm';

const MINIMUM_COLS = 2;
const MINIMUM_ROWS = 1;

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

/**
 * Compute terminal cols/rows from a container element's pixel dimensions and
 * the terminal's CSS cell size.
 *
 * @param container  The element whose CSS width/height defines the available area.
 * @param cellWidth  Terminal cell width in CSS pixels (terminal.dimensions.css.cell.width).
 * @param cellHeight Terminal cell height in CSS pixels (terminal.dimensions.css.cell.height).
 * @param scrollbarWidth Width in pixels to subtract for the scrollbar (0 when scrollback=0).
 */
export function measureDimensions(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
  scrollbarWidth = 0
): TerminalDimensions | null {
  if (cellWidth === 0 || cellHeight === 0) return null;
  // A container with no layout box — detached, or inside a hidden retained
  // tab (display: none) — has no size. Its resolved width/height are then the
  // computed values (e.g. '100%'), which parse as a ~100 px terminal and
  // would shrink the PTY to ~13 columns (devstation-1b9, devstation-8x9).
  if (!container.isConnected || container.getClientRects().length === 0) return null;
  const style = window.getComputedStyle(container);
  const width = Math.max(0, Number.parseInt(style.width));
  const height = Number.parseInt(style.height);
  if (Number.isNaN(width) || Number.isNaN(height) || height === 0) return null;
  return {
    cols: Math.max(MINIMUM_COLS, Math.floor((width - scrollbarWidth) / cellWidth)),
    rows: Math.max(MINIMUM_ROWS, Math.floor(height / cellHeight)),
  };
}

/**
 * The width xterm's overlay scrollbar covers at the viewport's right edge,
 * taken off the measured width as FitAddon.proposeDimensions() takes it
 * (devstation-iyx): none without scrollback, else the overview ruler's width
 * when one is set, else xterm's default scrollbar size — which is internal to
 * xterm, so it is read from the vertical scrollbar xterm rendered at that size.
 */
export function measureScrollbarWidth(terminal: Terminal): number {
  if (terminal.options.scrollback === 0) return 0;
  const rulerWidth = terminal.options.overviewRuler?.width;
  if (rulerWidth) return rulerWidth;
  const bar = terminal.element?.querySelector<HTMLElement>(
    '.xterm-scrollable-element > .scrollbar.vertical'
  );
  if (!bar) throw new Error('xterm rendered no vertical scrollbar to measure');
  return bar.offsetWidth;
}
