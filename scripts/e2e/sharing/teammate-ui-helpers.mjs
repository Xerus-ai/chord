/* global document -- frame.evaluate callbacks run inside the artifact frame */
/**
 * Driving one account's app in the P6 sharing done-check: following a
 * chord:// link, finding the artifact frame that shows a marker, waiting for
 * Chromium's PDF viewer to actually load a document, and screenshots into
 * screenshots/e2e.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../experience/run-record.mjs';
import { waitFor } from './sharing-accounts.mjs';

export const SHOT_DIR = E2E_SHOTS_DIR;
/** Chromium's built-in PDF viewer extension; each open PDF is a guest WebContents of its own. */
const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';

/**
 * Hands the app a chord:// link as the OS does (a second instance). When the
 * main-process evaluate fails, the error carries what the app did around it:
 * Playwright reports any inspector failure as "Execution context was
 * destroyed", which alone cannot tell a dead main from a reloaded window
 * (devstation-a6f).
 */
export async function followLink(account, url) {
  try {
    await account.instance.app.evaluate(({ app }, link) => {
      app.emit('second-instance', {}, [process.execPath, link], process.cwd());
    }, url);
  } catch (error) {
    const timeline = account.instance.readTimeline();
    const stderr = account.instance.readStderr().slice(-2000);
    throw new Error(
      `${error.message}
  ${account.label} app timeline: ${timeline.join(' | ') || 'nothing unusual'}` +
        `
  main stderr (last 2000 chars): ${stderr || '(empty)'}`,
      { cause: error }
    );
  }
}

export async function screenshot(account, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await account.instance.page.screenshot({ path: join(SHOT_DIR, `p6-${name}.png`) });
}

/**
 * The window as the OS composites it. Playwright's screenshot shows the PDF
 * viewer guest mid-layout (a thumbnail sidebar, no page) while the window
 * itself shows the loaded page, so a PDF is captured here.
 */
export async function screenshotComposited(account, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const png = await account.instance.app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(SHOT_DIR, `p6-${name}.png`), Buffer.from(png, 'base64'));
}

/** The artifact frame whose rendered text includes `marker`, or null after `timeoutMs`. */
export async function findFrameWith(page, marker, timeoutMs = 60_000) {
  let found = null;
  await waitFor(
    async () => {
      for (const frame of page.frames()) {
        if (!frame.url().startsWith('chord-artifact://')) continue;
        const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        if (text.includes(marker)) {
          found = frame;
          return true;
        }
      }
      return false;
    },
    timeoutMs,
    `a frame showing "${marker}"`
  ).catch(() => {});
  return found;
}

/** Throws when a frame showing `marker` is already on screen: the check about to open it would prove nothing. */
export async function assertNotShowing(page, marker, what) {
  if (await findFrameWith(page, marker, 1_500)) {
    throw new Error(`${what} is already on screen before the step that should open it`);
  }
}

/**
 * Waits for Chromium's viewer to load the PDF in the pdf file viewer's frame:
 * the guest whose document came from that frame's URL, with a page count.
 * The viewer's frame appears before the document loads, so its presence
 * alone proves nothing. Returns the page count (0 if it never loaded) and
 * what each viewer guest reported, for the failure detail.
 */
export async function waitForPdfDocument(account) {
  let loaded = { pages: 0, seen: [] };
  await waitFor(
    async () => {
      const src = await account.instance.page
        .locator('[data-file-viewer="pdf"] iframe')
        .first()
        .evaluate((el) => el.src, null, { timeout: 1_000 })
        .catch(() => null);
      if (!src) return false;
      loaded = await account.instance.app.evaluate(
        async ({ webContents }, { origin, frameUrl }) => {
          const seen = [];
          for (const guest of webContents.getAllWebContents()) {
            if (!guest.getURL().startsWith(origin)) continue;
            const state = await guest
              .executeJavaScript(
                `(() => { const viewer = document.querySelector('pdf-viewer');
                  return { url: viewer?.originalUrl ?? null,
                    pages: viewer?.shadowRoot?.querySelector('viewer-toolbar')?.docLength ?? 0 }; })()`
              )
              .catch(() => null);
            if (state) seen.push(state);
          }
          const match = seen.find((s) => s.url === frameUrl && s.pages > 0);
          return { pages: match?.pages ?? 0, seen };
        },
        { origin: PDF_VIEWER_ORIGIN, frameUrl: src }
      );
      return loaded.pages > 0;
    },
    45_000,
    'the PDF to load in the viewer'
  ).catch(() => {});
  return loaded;
}

export function describePdfLoad(loaded) {
  return loaded.pages > 0
    ? `${loaded.pages} page(s)`
    : `viewers: ${JSON.stringify(loaded.seen).slice(0, 300)}`;
}

export async function pdfFrameIsUnsandboxed(page) {
  return page
    .locator('[data-file-viewer="pdf"] iframe')
    .first()
    .evaluate((el) => !el.hasAttribute('sandbox') && el.src.startsWith('chord-artifact://'))
    .catch(() => false);
}

/** The rail is one app-wide store; a seeded profile may have it closed. */
export async function ensureRailOpen(page) {
  const bar = page.locator('[data-testid="rail-activity-bar"]');
  if (await bar.isVisible()) return;
  await page.getByRole('button', { name: 'Show right panel' }).first().click();
  await bar.waitFor({ timeout: 10_000 });
}

/**
 * The rail open on its Work item panel (the ARTIFACTS rows). Clicking the
 * panel already shown closes the rail (rail-store.ts `activate`), so its tab
 * is clicked only when another panel is showing.
 */
export async function showWorkItemPanel(page) {
  await ensureRailOpen(page);
  const tab = page
    .locator('[data-testid="rail-activity-bar"]')
    .getByRole('tab', { name: /^Work item/ })
    .first();
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}
