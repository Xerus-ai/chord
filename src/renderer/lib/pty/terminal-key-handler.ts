import type { Terminal } from '@xterm/xterm';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  shouldCopySelectionFromTerminal,
  shouldHandleInterruptFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
} from './pty-keybindings';

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export interface TerminalKeyActions {
  mapShiftEnterToCtrlJ?: boolean;
  sendInput: (data: string) => void;
  copySelection: () => void;
  paste: () => void;
  /** Ctrl+C reached the terminal (it still goes to the PTY). */
  onInterrupt: () => void;
}

/** Swallows the key event: the default handling and every other listener skip it. */
function consume(event: KeyboardEvent): false {
  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
  return false;
}

/** The terminal's keyboard shortcuts: copy, paste, Shift+Enter, kill-line, interrupt, macOS line jumps. */
export function attachTerminalKeyHandler(terminal: Terminal, actions: TerminalKeyActions): void {
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (document.querySelector('[role="dialog"]')) return false;

    if (shouldCopySelectionFromTerminal(event, IS_MAC_PLATFORM, terminal.hasSelection())) {
      consume(event);
      actions.copySelection();
      return false;
    }

    if (shouldPasteToTerminal(event, IS_MAC_PLATFORM)) {
      consume(event);
      actions.paste();
      return false;
    }

    if (actions.mapShiftEnterToCtrlJ && shouldMapShiftEnterToCtrlJ(event)) {
      consume(event);
      actions.sendInput(CTRL_J_ASCII);
      return false;
    }

    if (shouldKillLineFromTerminal(event, IS_MAC_PLATFORM)) {
      consume(event);
      actions.sendInput(CTRL_U_ASCII);
      return false;
    }

    if (shouldHandleInterruptFromTerminal(event)) {
      actions.onInterrupt();
      return true;
    }

    if (IS_MAC_PLATFORM && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      if (event.key === 'ArrowLeft') {
        consume(event);
        actions.sendInput('\x01');
        return false;
      }
      if (event.key === 'ArrowRight') {
        consume(event);
        actions.sendInput('\x05');
        return false;
      }
    }

    return true;
  });
}
