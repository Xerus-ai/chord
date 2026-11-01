import { shell, type BrowserWindow } from 'electron';
import { APP_ORIGIN } from '@main/app/protocol';

/**
 * Ensure any external HTTP(S) links open in the user's default browser
 * rather than inside the Electron window. Keeps app navigation scoped
 * to our renderer while preserving expected link behavior.
 */
export function registerExternalLinkHandlers(win: BrowserWindow, isDev: boolean) {
  const wc = win.webContents;

  const isInternalAppUrl = (url: string) => {
    if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL!);
    return (
      url.startsWith(`${APP_ORIGIN}/`) ||
      url.startsWith('file://') ||
      /^http:\/\/(127\.0\.0\.1|localhost):\d+(?:\/|$)/i.test(url)
    );
  };

  // Handle window.open and target="_blank". A new window would inherit this
  // window's preload bridge, so only the app's own origin may open one;
  // http(s) goes to the default browser and every other URL is dropped.
  wc.setWindowOpenHandler(({ url }) => {
    if (isInternalAppUrl(url)) return { action: 'allow' };
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept navigations that would leave the app
  wc.on('will-navigate', (event, url) => {
    if (!isInternalAppUrl(url) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}
