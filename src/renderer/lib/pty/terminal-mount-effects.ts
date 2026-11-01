import type { Terminal } from '@xterm/xterm';
import { log } from '@renderer/utils/logger';

/**
 * Answers DECRQM mode queries (`CSI ? Ps $ p` / `CSI Ps $ p`) with "not
 * recognized", working around the xterm.js 6.0 bug in its own reply. Returns
 * the cleanup; registration failing is logged and leaves nothing to clean up.
 */
export function registerDecrqmWorkaround(
  terminal: Terminal,
  sendInput: (data: string, options?: { track?: boolean }) => void
): () => void {
  try {
    const parser = (
      terminal as unknown as {
        parser?: { registerCsiHandler?: (...args: unknown[]) => { dispose(): void } };
      }
    ).parser;
    if (!parser?.registerCsiHandler) return () => {};
    const ansiDisp = parser.registerCsiHandler(
      { intermediates: '$', final: 'p' },
      (params: (number | number[])[]) => {
        const mode = (params[0] as number) ?? 0;
        sendInput(`\x1b[${mode};0$y`, { track: false });
        return true;
      }
    );
    const decDisp = parser.registerCsiHandler(
      { prefix: '?', intermediates: '$', final: 'p' },
      (params: (number | number[])[]) => {
        const mode = (params[0] as number) ?? 0;
        sendInput(`\x1b[?${mode};0$y`, { track: false });
        return true;
      }
    );
    return () => {
      ansiDisp.dispose();
      decDisp.dispose();
    };
  } catch (err) {
    log.warn('useTerminal: failed to register DECRQM workaround', { error: err });
    return () => {};
  }
}

/** Copies a settled selection while `isEnabled()` (Settings › Terminal › auto-copy). Returns the cleanup. */
export function subscribeAutoCopyOnSelection(
  terminal: Terminal,
  isEnabled: () => boolean,
  copySelection: () => void
): () => void {
  let selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const selectionDisposable = terminal.onSelectionChange(() => {
    if (!isEnabled()) return;
    if (!terminal.hasSelection()) return;
    if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {
      if (terminal.hasSelection()) copySelection();
    }, 150);
  });
  return () => {
    selectionDisposable.dispose();
    if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
  };
}
