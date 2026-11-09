import { join } from 'node:path';
import { BrowserWindow, webFrameMain } from 'electron';
import appIcon from '@/assets/images/chord/app-icon.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { ARTIFACT_FRAME_NAME_PREFIX } from '@shared/artifact-frame-constants';
import { windowFullScreenChangedChannel } from '@shared/events/appEvents';
import { artifactFrameNavigationBlockedChannel } from '@shared/events/artifactEvents';
import { ARTIFACT_PAGE_SCHEME } from '@main/core/artifact-pages/page-response-headers';
import { events } from '@main/lib/events';
import { capture, checkAndReportDailyActiveUser } from '@main/lib/telemetry';
import { registerExternalLinkHandlers } from '@main/utils/externalLinks';
import { APP_ORIGIN } from './protocol';

let mainWindow: BrowserWindow | null = null;

export type WindowChromeTheme = 'dark' | 'light';

/** Must equal the renderer's `--header-rail-height`. */
const WINDOW_CONTROLS_HEIGHT = 36;

/** The renderer's base surface per theme, shown before the renderer paints. */
const WINDOW_BACKGROUND: Record<WindowChromeTheme, string> = {
  dark: '#181b1a',
  light: '#ffffff',
};

/** The muted foreground per theme, for the minimize/maximize/close glyphs. */
const WINDOW_CONTROLS_SYMBOL: Record<WindowChromeTheme, string> = {
  dark: '#a1a5a4',
  light: '#71717a',
};

function windowControlsOverlay(theme: WindowChromeTheme): Electron.TitleBarOverlayOptions {
  return {
    color: '#00000000',
    symbolColor: WINDOW_CONTROLS_SYMBOL[theme],
    height: WINDOW_CONTROLS_HEIGHT,
  };
}

/** The renderer's theme, as last reported; windows main opens itself match it. */
let chromeTheme: WindowChromeTheme = 'dark';

export function getWindowChromeTheme(): WindowChromeTheme {
  return chromeTheme;
}

/** What a window shows before its page paints, per theme. */
export function getWindowBackground(theme: WindowChromeTheme): string {
  return WINDOW_BACKGROUND[theme];
}

/** Recolours the Windows/Linux controls overlay when the renderer's theme changes. */
export function applyWindowChromeTheme(theme: WindowChromeTheme): void {
  chromeTheme = theme;
  if (!mainWindow || process.platform === 'darwin') return;
  mainWindow.setTitleBarOverlay(windowControlsOverlay(theme));
  mainWindow.setBackgroundColor(WINDOW_BACKGROUND[theme]);
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 500,
    title: PRODUCT_NAME,
    // In production, electron-builder injects the icon from the app bundle.
    ...(import.meta.env.DEV && { icon: appIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Kept off, re-checked for Electron 45 (devstation-2dgv.5):
      // - The preload is ESM (.mjs), which a sandboxed renderer cannot load.
      // - nodeIntegration is off, contextIsolation is on, and the bridge
      //   exposes only invoke, eventSend/eventOn and getPathForFile.
      // - GHSA-9qh4-3jw8-366w needs <webview>, which is off (below).
      // - GHSA-gr2m-v5gq-v685 needs popups from a sandboxed top-level
      //   document; artifact frames are CSP `sandbox allow-scripts`, without
      //   allow-popups.
      // - Both advisories are fixed in 45, and since 45 window.open children
      //   default to a sandboxed process of their own.
      sandbox: false,
      // No <webview> exists in the renderer. Leaving the tag enabled with no
      // will-attach-webview handler would let any renderer-side script
      // execution attach a webview with its own preload — if an in-app
      // browser pane ever ships, re-enable this WITH a will-attach-webview
      // listener that strips webPreferences.preload and forces
      // nodeIntegration: false.
      webviewTag: false,
      // __dirname resolves to out/main/ at runtime; preload is at out/preload/index.mjs
      preload: join(__dirname, '../preload/index.mjs'),
    },
    // Frameless on every platform: the app draws its own 36px
    // header rails, and the OS controls sit over the top-right corner of them.
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 14, y: 12 },
          acceptFirstMouse: true,
        }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: windowControlsOverlay('dark'),
        }),
    backgroundColor: WINDOW_BACKGROUND.dark,
    show: false,
  });

  if (import.meta.env.DEV) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }

  // Route external links to the user’s default browser
  registerExternalLinkHandlers(mainWindow, import.meta.env.DEV);
  guardArtifactFrameNavigation(mainWindow);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Track window focus for telemetry
  mainWindow.on('focus', () => {
    capture('app_window_focused');
    if (typeof mainWindow?.setWindowButtonVisibility === 'function') {
      mainWindow.setWindowButtonVisibility(true);
    }
    void checkAndReportDailyActiveUser();
  });

  mainWindow.on('blur', () => {
    capture('app_window_unfocused');
  });

  // The sidebar leaves room for the macOS window buttons, which full screen hides.
  mainWindow.on('enter-full-screen', () => {
    events.emit(windowFullScreenChangedChannel, { fullScreen: true });
  });
  mainWindow.on('leave-full-screen', () => {
    events.emit(windowFullScreenChangedChannel, { fullScreen: false });
  });

  // Cleanup reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Two guards on where an artifact page frame may take itself. The renderer
 * CSP's `frame-src chord-artifact:` is the one that actually fires: Chromium
 * refuses the navigation with ERR_BLOCKED_BY_CSP before any event reaches
 * main, and leaves its error page in the frame. That failure is forwarded to
 * the renderer, keyed by the iframe's `name`, so the host that owns the frame
 * mounts its page again. `will-frame-navigate` stays as a backstop for any
 * scheme the CSP might admit in future: every subframe navigation is held to
 * the artifact page scheme.
 */
function guardArtifactFrameNavigation(win: BrowserWindow): void {
  win.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame || details.isSameDocument) return;
    if (details.url.startsWith(`${ARTIFACT_PAGE_SCHEME}://`)) return;
    details.preventDefault();
  });
  win.webContents.on(
    'did-fail-load',
    (_event, _code, _description, validatedUrl, isMainFrame, processId, routingId) => {
      if (isMainFrame || validatedUrl.startsWith(`${ARTIFACT_PAGE_SCHEME}://`)) return;
      const frame = webFrameMain.fromId(processId, routingId);
      if (!frame || !frame.name.startsWith(ARTIFACT_FRAME_NAME_PREFIX)) return;
      events.emit(artifactFrameNavigationBlockedChannel, {
        frameName: frame.name,
        url: validatedUrl,
      });
    }
  );
}

export function isMainWindowFullScreen(): boolean {
  if (!mainWindow) throw new Error('The main window is not open');
  return mainWindow.isFullScreen();
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
