import { type Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { AppSettings } from '@shared/app-settings';
import { appPasteChannel } from '@shared/events/appEvents';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/ptyEvents';
import { events, rpc } from '@renderer/lib/ipc';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { buildFontFamily } from './font-family';
import { buildTheme, type FrontendPty, type SessionTheme } from './pty';
import { isRealTaskInput, SubmittedInputBuffer } from './pty-input-buffer';
import { attachTerminalKeyHandler } from './terminal-key-handler';
import { registerDecrqmWorkaround, subscribeAutoCopyOnSelection } from './terminal-mount-effects';
import { usePtyResize } from './use-pty-resize';
import { onCellSizeChange } from './xterm-cell-metrics';

export interface UsePtyOptions {
  /** Deterministic PTY session ID: makePtySessionId(projectId, scopeId, leafId). */
  sessionId: string;
  /** Pre-connected FrontendPty instance owned by the entity's PtySession store. */
  pty: FrontendPty;
  theme?: SessionTheme;
  mapShiftEnterToCtrlJ?: boolean;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onInterruptPress?: () => void;
}

export interface UseTerminalReturn {
  focus: () => void;
  setTheme: (theme: SessionTheme) => void;
  sendInput: (data: string, options?: { track?: boolean }) => void;
}

/**
 * React hook that manages a full xterm.js terminal instance attached to
 * `containerRef`, wired to a PTY session via the deterministic `sessionId`.
 *
 * Each session owns a persistent FrontendPty (terminal + Canvas2D renderer)
 * for its full lifetime.  On unmount the terminal's ownedContainer is
 * reparented to the off-screen xterm host rather than disposed, so scrollback
 * is preserved across tab switches.
 *
 * The caller passes the session's already-connected FrontendPty (`pty`), so
 * mounting is synchronous; there is no registration or buffer fetch here.
 */
export function usePty(
  options: UsePtyOptions,
  containerRef: React.RefObject<HTMLElement | null>
): UseTerminalReturn {
  const {
    sessionId,
    pty,
    theme,
    mapShiftEnterToCtrlJ,
    onActivity,
    onExit,
    onFirstMessage,
    onEnterPress,
    onInterruptPress,
  } = options;

  // Stable refs for callbacks so the effect doesn't re-run on every render.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onFirstMessageRef = useRef(onFirstMessage);
  onFirstMessageRef.current = onFirstMessage;
  const onEnterPressRef = useRef(onEnterPress);
  onEnterPressRef.current = onEnterPress;
  const onInterruptPressRef = useRef(onInterruptPress);
  onInterruptPressRef.current = onInterruptPress;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Subscribe to panel drag state so ResizeObserver skips fits while dragging.
  const isPanelDragging = useSyncExternalStore(
    panelDragStore.subscribe,
    panelDragStore.getSnapshot
  );
  // Keep a ref in sync so the ResizeObserver callback (inside the main effect)
  // always reads the latest value without re-running the effect.
  const isPanelDraggingRef = useRef(isPanelDragging);
  isPanelDraggingRef.current = isPanelDragging;

  // Core xterm.js reference, kept alive across renders.
  const termRef = useRef<Terminal | null>(null);

  const { measureAndResize, resetPtyResize } = usePtyResize(sessionId, termRef, containerRef);

  // First-message capture state.
  const firstMessageSentRef = useRef(false);
  const inputBufferRef = useRef('');

  // Tracks submitted user input while filtering terminal control traffic.
  const submittedInputBufferRef = useRef(new SubmittedInputBuffer());

  // Track whether the PTY has started (to filter focus reporting escape sequences).
  const ptyStartedRef = useRef(false);

  // Auto-copy on selection
  const autoCopyOnSelectionRef = useRef(false);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const applyTheme = useCallback((t?: SessionTheme) => {
    if (!termRef.current) return;
    termRef.current.options.theme = buildTheme(t);
  }, []);

  const setTheme = useCallback(
    (t: SessionTheme) => {
      applyTheme(t);
    },
    [applyTheme]
  );

  const focus = useCallback(() => {
    if (document.activeElement?.closest('[role="dialog"]')) return;
    termRef.current?.focus();
  }, []);

  const copySelectionToClipboard = useCallback(() => {
    const selection = termRef.current?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {});
    }
  }, []);

  const sendInput = useCallback(
    (data: string, options?: { track?: boolean }) => {
      const shouldTrack = options?.track ?? true;
      if (shouldTrack) {
        const submittedMessages = submittedInputBufferRef.current.feed(data);
        for (const message of submittedMessages) {
          if (isRealTaskInput(message)) {
            onEnterPressRef.current?.(message);
          }
        }
      }
      void rpc.pty.sendInput(sessionId, data);
    },
    [sessionId]
  );

  const pasteFromClipboard = useCallback(() => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) sendInput(text);
      })
      .catch(() => {});
  }, [sendInput]);

  // ─── Main effect: mount terminal once per sessionId ────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // pty is pre-connected by PtySession before TerminalPane renders, so no
    // async work is needed here.
    const cleanups: (() => void)[] = [];
    const terminal = pty.terminal;
    termRef.current = terminal;

    // Apply current theme before mounting (in case it differs from the
    // theme the terminal was constructed with).
    terminal.options.theme = buildTheme(themeRef.current);

    pty.mount(container as HTMLElement);

    // Always sync after mounting — the pane may have been resized while this
    // session was off-screen.  measureAndResize defers to rAF so it reads the
    // live DOM and only calls term.resize() when needed.
    measureAndResize();

    // ── Load settings ────────────────────────────────────────────────────────
    let customFontFamily = '';
    void (rpc.appSettings.get('terminal') as Promise<AppSettings['terminal']>).then(
      (terminalSettings) => {
        if (terminalSettings?.fontFamily) {
          customFontFamily = terminalSettings.fontFamily.trim();
          if (customFontFamily) terminal.options.fontFamily = buildFontFamily(customFontFamily);
        }
        autoCopyOnSelectionRef.current = terminalSettings?.autoCopyOnSelection ?? false;
      }
    );

    cleanups.push(registerDecrqmWorkaround(terminal, sendInput));

    attachTerminalKeyHandler(terminal, {
      mapShiftEnterToCtrlJ,
      sendInput,
      copySelection: copySelectionToClipboard,
      paste: pasteFromClipboard,
      onInterrupt: () => onInterruptPressRef.current?.(),
    });

    // ── Handle terminal input ────────────────────────────────────────────────
    const handleTerminalInput = (data: string) => {
      onActivityRef.current?.();

      let filtered = data;
      if (!ptyStartedRef.current) {
        filtered = data.replace(/\x1b\[I|\x1b\[O/g, '');
      }
      if (!filtered) return;

      // First-message capture
      if (!firstMessageSentRef.current && onFirstMessageRef.current) {
        inputBufferRef.current += filtered;
        const newlineIndex = inputBufferRef.current.indexOf('\r');
        if (newlineIndex !== -1) {
          const message = inputBufferRef.current.slice(0, newlineIndex);
          onFirstMessageRef.current(message);
          firstMessageSentRef.current = true;
        }
      }

      sendInput(filtered);
    };

    const inputDisposable = terminal.onData((data) => handleTerminalInput(data));
    cleanups.push(() => inputDisposable.dispose());

    // ── ptyStartedRef — detect first PTY output ──────────────────────────────
    // FrontendPty owns the data subscription and writes directly to the
    // terminal.  We add a lightweight IPC listener here solely to flip the
    // ptyStartedRef flag, which is used to suppress focus-reporting escape
    // sequences before the PTY shell has initialised.
    const offPtyData = events.on(
      ptyDataChannel,
      () => {
        ptyStartedRef.current = true;
      },
      sessionId
    );
    cleanups.push(offPtyData);

    cleanups.push(
      subscribeAutoCopyOnSelection(
        terminal,
        () => autoCopyOnSelectionRef.current,
        copySelectionToClipboard
      )
    );

    // ── Paste from app menu ──────────────────────────────────────────────────
    const offPaste = events.on(appPasteChannel, () => {
      pasteFromClipboard();
    });
    cleanups.push(offPaste);

    // ── PTY exit subscription ────────────────────────────────────────────────
    const offExit = events.on(
      ptyExitChannel,
      (info) => {
        onExitRef.current?.(info as { exitCode: number | undefined; signal?: number });
      },
      sessionId
    );
    cleanups.push(offExit);

    // ── Font / setting change events ─────────────────────────────────────────
    const handleFontChange = (e: Event) => {
      const detail = (e as CustomEvent<{ fontFamily?: string }>).detail;
      customFontFamily = detail?.fontFamily?.trim() ?? '';
      terminal.options.fontFamily = buildFontFamily(customFontFamily);
      measureAndResize();
    };
    const handleAutoCopyChange = (e: Event) => {
      const detail = (e as CustomEvent<{ autoCopyOnSelection?: boolean }>).detail;
      autoCopyOnSelectionRef.current = detail?.autoCopyOnSelection ?? false;
    };
    window.addEventListener('terminal-font-changed', handleFontChange);
    window.addEventListener('terminal-auto-copy-changed', handleAutoCopyChange);
    cleanups.push(
      () => window.removeEventListener('terminal-font-changed', handleFontChange),
      () => window.removeEventListener('terminal-auto-copy-changed', handleAutoCopyChange)
    );

    // ── ResizeObserver (observes the mount-target, not the owned container) ───
    // Skips measuring while a panel drag is in progress; the drag-end effect
    // below fires one measure once the drag completes.
    const resizeObserver = new ResizeObserver(() => {
      if (!isPanelDraggingRef.current) measureAndResize();
    });
    resizeObserver.observe(container);
    cleanups.push(() => resizeObserver.disconnect());

    // ── Cell-size changes (font setting, webfont arrival, display scale) ─────
    const cellSizeDisposable = onCellSizeChange(terminal, () => measureAndResize());
    cleanups.push(() => cellSizeDisposable.dispose());

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      // Also resets dedup so the next session always gets a resize on mount.
      resetPtyResize();
      // ResizeObserver.disconnect() and other cleanups run BEFORE unmount —
      // preserving the invariant that the ResizeObserver is torn down before
      // the ownedContainer is reparented off-screen.
      for (const fn of cleanups) {
        try {
          fn();
        } catch {}
      }
      // Return terminal's ownedContainer to the off-screen host.
      pty.unmount();
      termRef.current = null;
      ptyStartedRef.current = false;
      firstMessageSentRef.current = false;
      inputBufferRef.current = '';
      submittedInputBufferRef.current = new SubmittedInputBuffer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pty]); // Re-run only when the session changes

  // ── Theme update (after initial mount) ──────────────────────────────────────
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  // ── Measure once when a panel drag ends ─────────────────────────────────────
  // The ResizeObserver skips measurements during the drag; this effect fires a
  // single measurement (which resizes the terminal and notifies PTYs) when done.
  const prevIsPanelDraggingRef = useRef(isPanelDragging);
  useEffect(() => {
    const wasDragging = prevIsPanelDraggingRef.current;
    prevIsPanelDraggingRef.current = isPanelDragging;
    if (wasDragging && !isPanelDragging) {
      measureAndResize();
    }
  }, [isPanelDragging, measureAndResize]);

  return { focus, setTheme, sendInput };
}
