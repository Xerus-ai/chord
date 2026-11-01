import { BrowserWindow } from 'electron';
import { PAGE_MOUNT_ID } from '@main/core/artifact-pages/bundle-prototype';
import type { FilePageSource } from '@main/core/artifact-pages/page-source-registry';
import { preparePage } from '@main/core/artifact-pages/prepare-page';

/**
 * Renders an artifact page to PNG for Confluence (P5 decision 2026-09-24:
 * prototypes and MDX components publish as static images). The page is built
 * and served exactly as the in-app frame gets it — same `chord-artifact://`
 * origin, same sandbox CSP — but in a hidden window of its own with no
 * preload, so nothing the page runs can reach Chord.
 */

const SNAPSHOT_WIDTH = 1024;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 4000;
/** No DOM change for this long means charts and transitions have finished. */
const QUIET_MS = 400;
const SETTLE_TIMEOUT_MS = 8000;

/**
 * Resolves once the document has gone QUIET_MS without a mutation (charts
 * animate by rewriting SVG attributes every frame), or after the timeout.
 * Reports the content height and whether the page rendered anything at all.
 */
const SETTLE_SCRIPT = `new Promise((resolve) => {
  let timer;
  const done = () => {
    observer.disconnect();
    const root = document.getElementById(${JSON.stringify(PAGE_MOUNT_ID)});
    resolve({
      height: Math.ceil(document.documentElement.scrollHeight),
      rendered: root ? root.childElementCount > 0 : document.body.childElementCount > 0,
    });
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(done, ${QUIET_MS});
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  timer = setTimeout(done, ${QUIET_MS});
  setTimeout(done, ${SETTLE_TIMEOUT_MS});
})`;

interface SettledPage {
  height: number;
  rendered: boolean;
}

export async function captureArtifactPageSnapshot(source: FilePageSource): Promise<Buffer> {
  // Confluence pages are light; the snapshot matches the page it sits in.
  const url = await preparePage(source, 'chord-light');
  const window = new BrowserWindow({
    show: false,
    width: SNAPSHOT_WIDTH,
    height: MIN_HEIGHT,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  try {
    await window.loadURL(url);
    const first = (await window.webContents.executeJavaScript(SETTLE_SCRIPT)) as SettledPage;
    if (!first.rendered) {
      throw new Error(`${source.filePath} rendered nothing to snapshot`);
    }
    const height = Math.min(Math.max(first.height, MIN_HEIGHT), MAX_HEIGHT);
    window.setContentSize(SNAPSHOT_WIDTH, height);
    // Layout reflows at the new size before the capture.
    await window.webContents.executeJavaScript(SETTLE_SCRIPT);
    const image = await window.webContents.capturePage();
    if (image.isEmpty()) throw new Error(`Snapshot of ${source.filePath} came back empty`);
    return image.toPNG();
  } finally {
    window.destroy();
  }
}
