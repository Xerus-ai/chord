import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { getMainWindow, getWindowBackground, getWindowChromeTheme } from '@main/app/window';
import { resolveArtifactRuntimeDir } from '@main/core/artifact-pages/artifact-runtime-dir';
import { log } from '@main/lib/logger';
import {
  readTrustAnswer,
  renderTrustPromptPage,
  type TrustAnswer,
  type TrustPromptContent,
} from './trust-prompt-page';

/**
 * The script-approval prompt: a child window of main's own, its page in Chord's theme.
 *
 * The main window renders agent output, artifacts and web content, so it is
 * never asked for the answer — any script there can send on any IPC channel.
 * This window has no preload and loads a script-free page. The answer is the
 * link the user follows, read from — and cancelled in — this window's own
 * `will-navigate`: nothing else can produce one, and the page never leaves.
 */

/** Prompts open over the main window; it takes input again once none is. */
let openPrompts = 0;

/** What `modal` would do: the main window takes no input while a prompt is open. */
function holdParent(parent: BrowserWindow, prompt: BrowserWindow): void {
  openPrompts++;
  parent.setEnabled(false);
  prompt.once('closed', () => {
    openPrompts--;
    if (openPrompts === 0 && !parent.isDestroyed()) {
      parent.setEnabled(true);
      parent.focus();
    }
  });
}

/**
 * Shows the prompt and resolves with the user's answer — 'run', 'run-always'
 * or 'decline' — or null when it was closed without one (Esc or the window's
 * close button). The caller records approvals; nothing else is recorded.
 */
export function showTrustPromptWindow(content: TrustPromptContent): Promise<TrustAnswer | null> {
  const theme = getWindowChromeTheme();
  const page = renderTrustPromptPage({
    ...content,
    theme,
    tokenSheet: readFileSync(join(resolveArtifactRuntimeDir(), 'tokens.css'), 'utf8'),
  });

  const parent = getMainWindow() ?? undefined;
  // The OS frame, not the main window's frameless one: on Windows (Electron
  // 40), a child window with `titleBarStyle: 'hidden'` — with or without
  // `titleBarOverlay` — crashes the app (0xC000041D) when it closes after a
  // real mouse click, even when the close is deferred a tick. The page is
  // themed; only the OS title bar follows the Windows light/dark setting.
  const win = new BrowserWindow({
    parent,
    // Not `modal`: with a modal window the parent is disabled by Electron;
    // `holdParent` does it by hand, the combination proven clean with a real click.
    modal: false,
    width: 680,
    height: 600,
    minWidth: 480,
    minHeight: 360,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Run scripts?',
    show: false,
    backgroundColor: getWindowBackground(theme),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  if (parent) holdParent(parent, win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') win.close();
  });

  return new Promise((resolve, reject) => {
    let answer: TrustAnswer | null = null;
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault();
      const given = readTrustAnswer(event.url);
      if (given === null) {
        log.warn('[trust] blocked a navigation that is not an answer', { url: event.url });
        return;
      }
      answer = given;
      win.close();
    });
    win.once('closed', () => {
      log.info('[trust] prompt closed', { repoPath: content.repoPath, answer });
      resolve(answer);
    });
    win.once('ready-to-show', () => win.show());
    win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
      .catch((error: unknown) => {
        win.destroy();
        reject(error);
      });
  });
}
