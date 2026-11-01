import type { Terminal } from '@xterm/xterm';
import { useCallback, useRef } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { measureDimensions, measureScrollbarWidth } from './pty-dimensions';
import { getCellMetrics } from './xterm-cell-metrics';

const PTY_RESIZE_DEBOUNCE_MS = 120;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;

export interface PtyResize {
  /** Fits the terminal to its container on the next frame and queues the PTY resize. */
  measureAndResize: () => void;
  /** Drops a queued PTY resize and forgets the last size sent, so the next mount always sends one. */
  resetPtyResize: () => void;
}

/**
 * Terminal measurement and the debounced PTY resize queue for one session.
 * `measureAndResize` is the single entry point for all DOM measurement and
 * PTY resize work.
 */
export function usePtyResize(
  sessionId: string,
  termRef: React.RefObject<Terminal | null>,
  containerRef: React.RefObject<HTMLElement | null>
): PtyResize {
  const pendingResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const queuePtyResize = useCallback(
    (newCols: number, newRows: number) => {
      const c = Math.max(MIN_TERMINAL_COLS, Math.floor(newCols));
      const r = Math.max(MIN_TERMINAL_ROWS, Math.floor(newRows));
      const last = lastSentResizeRef.current;
      if (last?.cols === c && last?.rows === r) return;
      if (pendingResizeTimerRef.current) clearTimeout(pendingResizeTimerRef.current);
      pendingResizeTimerRef.current = setTimeout(() => {
        pendingResizeTimerRef.current = null;
        lastSentResizeRef.current = { cols: c, rows: r };
        void rpc.pty.resize(sessionId, c, r);
      }, PTY_RESIZE_DEBOUNCE_MS);
    },
    [sessionId]
  );

  // Mirrors xterm's FitAddon.proposeDimensions() by measuring
  // terminal.element.parentElement (the FrontendPty's ownedContainer) — the
  // exact space the terminal occupies — rather than a distant ancestor div.
  const measureAndResize = useCallback(() => {
    const attempt = (retries: number) => {
      if (!termRef.current) return;
      requestAnimationFrame(() => {
        try {
          const term = termRef.current;
          if (!term) return;

          const cell = getCellMetrics(term);
          if (!cell) {
            // Cold-path: terminal was opened off-DOM so xterm's font measurement
            // hasn't populated yet.  Retry up to 5 times to avoid an infinite loop.
            if (retries < 5) {
              setTimeout(() => attempt(retries + 1), 100);
            }
            return;
          }

          // Measure the terminal's immediate parent (the FrontendPty's ownedContainer),
          // matching FitAddon.proposeDimensions().  Fall back to the mount-target
          // container for standalone terminals not using the pool.
          const termParent = (term as unknown as { element?: HTMLElement }).element?.parentElement;
          const measureTarget = termParent ?? (containerRef.current as HTMLElement | null);
          if (!measureTarget) return;

          const dims = measureDimensions(
            measureTarget,
            cell.width,
            cell.height,
            measureScrollbarWidth(term)
          );
          if (!dims) return;
          const { cols: targetCols, rows: targetRows } = dims;

          if (term.cols !== targetCols || term.rows !== targetRows) {
            term.resize(targetCols, targetRows);
          }
          queuePtyResize(targetCols, targetRows);
        } catch (e) {
          log.warn('useTerminal: measureAndResize failed', { sessionId, error: e });
        }
      });
    };
    attempt(0);
  }, [sessionId, termRef, containerRef, queuePtyResize]);

  const resetPtyResize = useCallback(() => {
    if (pendingResizeTimerRef.current) {
      clearTimeout(pendingResizeTimerRef.current);
      pendingResizeTimerRef.current = null;
    }
    lastSentResizeRef.current = null;
  }, []);

  return { measureAndResize, resetPtyResize };
}
