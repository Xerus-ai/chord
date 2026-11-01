import type { Terminal } from '@xterm/xterm';

// xterm's proposed API and internal fields are not in the public TypeScript
// types. Both code paths are necessary: the proposed `dimensions` API works in
// xterm 5.x, while xterm 6.x exposes cell metrics only via `_core`.
interface XtermCellDimensions {
  css: { cell: { width: number; height: number } };
}
interface XtermRenderService {
  dimensions?: XtermCellDimensions;
  onDimensionsChange?: (listener: () => void) => { dispose(): void };
}
interface XtermInternals {
  dimensions?: XtermCellDimensions;
  _core?: {
    _renderService?: XtermRenderService;
    renderService?: XtermRenderService;
  };
}

/**
 * Subscribes to the terminal's cell-size changes. A font, the arrival of the
 * mono webfont, or a display-scale change resizes the cells without resizing
 * the pane, so the ResizeObserver never sees it.
 */
export function onCellSizeChange(terminal: Terminal, listener: () => void): { dispose(): void } {
  const core = (terminal as unknown as XtermInternals)._core;
  const service = core?._renderService ?? core?.renderService;
  if (!service?.onDimensionsChange) {
    throw new Error('xterm render service has no onDimensionsChange');
  }
  return service.onDimensionsChange(listener);
}

export function getCellMetrics(terminal: Terminal): { width: number; height: number } | null {
  const t = terminal as unknown as XtermInternals;
  // Proposed API (xterm 5.x). Undefined on the public Terminal in xterm 6.x.
  const dims = t.dimensions;
  if (dims && dims.css.cell.width !== 0 && dims.css.cell.height !== 0) {
    return { width: dims.css.cell.width, height: dims.css.cell.height };
  }
  // xterm 6.x: the public Terminal delegates to `_core` (the internal Terminal instance).
  // FitAddon receives this same internal object via addon.activate(terminal).
  const coreDims = t._core?._renderService?.dimensions ?? t._core?.renderService?.dimensions;
  if (coreDims?.css?.cell?.width && coreDims.css.cell.height) {
    return { width: coreDims.css.cell.width, height: coreDims.css.cell.height };
  }
  return null;
}
