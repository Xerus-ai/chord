/* global window, document, getComputedStyle -- page.evaluate and waitForFunction callbacks run inside the app window */
/**
 * Live check of the version handshake, driven through the
 * real app: the main process reads <CHORD_CLOUD_API_URL>/health and compares
 * the app's version with the server's min_desktop_version.
 *   - a server whose minimum is above the app's version: the app shows the
 *     "Update required" screen naming both versions, and not the workspace;
 *     Check for updates shows the updater working (or its answer), and Download
 *     from website opens the releases page and quits;
 *   - a server whose minimum IS the app's version (the equality boundary): the
 *     app goes on to its normal first screen (sign-in, on a fresh profile);
 *   - no server at all: the first reading is unknown, which never blocks, so the
 *     app leaves its placeholder for sign-in, which says the server could not be
 *     reached;
 *   - a server that accepts the connection and never answers: the first reading
 *     gives up within its short timeout, so sign-in shows in under 4 s.
 * CHORD_RELEASES_URL points at the same local server, so the website action
 * opens a local page in the default browser and the server sees it.
 * Each launch points CHORD_CLOUD_API_URL at a local server answering /health as
 * the sync server does (other paths 404), so the minimum can be set per launch.
 * The handshake comes before the session gates, so each launch is a fresh,
 * signed-out profile: no seed account is needed, and none is spent.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/suites/update-required.mjs
 *
 * Screenshots: <e2e out>/screenshots/update-required-NN-*.png.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { E2E_SHOTS_DIR, E2E_VIDEO_DIR, recordRunOnExit } from '../lib/experience/run-record.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP_VERSION = JSON.parse(
  readFileSync(join(resolve(process.env.CHORD_E2E_APP_DIR ?? ROOT), 'package.json'), 'utf-8')
).version;

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `update-required-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
/**
 * Waits until no finite animation is running (the sign-in wordmark draws in over
 * a second or more), so a screenshot shows the settled screen, not a frame of
 * the transition. Infinite animations (spinners) are ignored.
 */
async function settle(page) {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
    null,
    { timeout: 15_000 }
  );
}

/**
 * Waits for the sign-in screen to finish its boot sequence: the Sign in button
 * fully opaque (Playwright counts an opacity-0 element as visible, and the
 * sequence's phases are timers, so no animation runs between them), then settled.
 */
async function signInShown(page) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Sign in' && getComputedStyle(b).opacity === '1'
      ),
    null,
    { timeout: 30_000 }
  );
  await settle(page);
}

function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

/** A server that accepts every connection and never answers, as a network that drops requests. */
async function silentServer() {
  const sockets = new Set();
  const server = createTcpServer((socket) => sockets.add(socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  };
  return { url: `http://127.0.0.1:${server.address().port}`, hits: [], close };
}

/**
 * A local sync server stand-in: /health with the given minimum, /releases as the
 * download page. A null minimum is no server at all (a port nobody listens on);
 * 'silent' is one that never answers. Resolves to { url, hits, close }.
 */
async function healthServer(minimum) {
  if (minimum === 'silent') return silentServer();
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/releases') {
      res.setHeader('content-type', 'text/html');
      res.end('<h1>Chord releases (e2e stand-in)</h1>');
      return;
    }
    if (req.url !== '/health') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', min_desktop_version: minimum }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve) => server.close(resolve));
  if (minimum === null) {
    await close();
    return { url, hits, close: async () => {} };
  }
  return { url, hits, close };
}

async function withApp(minimum, profilePrefix, check) {
  const health = await healthServer(minimum);
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not set');
  const profile = `${profilePrefix}-${Date.now()}`;
  recordRunOnExit();
  const app = await electron.launch({
    executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [resolve(process.env.CHORD_E2E_APP_DIR ?? ROOT), '--no-sandbox'],
    cwd: ROOT,
    timeout: 90_000,
    ...(process.env.CHORD_E2E_VIDEO
      ? { recordVideo: { dir: E2E_VIDEO_DIR, size: { width: 1280, height: 800 } } }
      : {}),
    env: {
      ...process.env,
      CHORD_PROFILE: profile,
      CHORD_DISABLE_PTY: '1',
      CHORD_CLOUD_API_URL: health.url,
      CHORD_RELEASES_URL: `${health.url}/releases`,
    },
  });
  let closed = false;
  const quit = new Promise((resolve) =>
    app.on('close', () => {
      closed = true;
      resolve();
    })
  );
  const page = await app.firstWindow({ timeout: 90_000 });
  const windowAt = Date.now();
  try {
    await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 60_000 });
    const rpc = (channel, ...args) =>
      page.evaluate(([c, a]) => window.electronAPI.invoke(c, ...a), [channel, args]);
    await check({ page, rpc, quit, hits: health.hits, windowAt });
  } catch (error) {
    if (!closed) await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    if (!closed) await app.close();
    rmSync(join(appData, profile), { recursive: true, force: true });
    await health.close();
  }
}

async function main() {
  await withApp('99.0.0', 'chord-update-required', async ({ page, rpc, quit, hits }) => {
    await page.getByRole('heading', { name: 'Update required' }).waitFor({ timeout: 60_000 });
    await settle(page);
    await page.screenshot({ path: shot('blocked') });
    const text = await page.locator('main').innerText();
    verdict(
      'names the minimum version',
      text.includes('99.0.0'),
      text.replace(/\s+/g, ' ').slice(0, 160)
    );
    const state = await rpc('app.getDesktopCompatibility');
    verdict(
      'main holds update_required with the app version',
      state?.state === 'update_required' && text.includes(state.current),
      JSON.stringify(state ?? null)
    );
    verdict(
      'neither sign-in nor the workspace is shown',
      (await page.getByRole('button', { name: 'Sign in' }).count()) === 0 &&
        (await page.getByTitle('Settings', { exact: true }).count()) === 0,
      ''
    );
    const check = page.getByRole('button', { name: /check for updates/i });
    verdict('offers Check for updates', (await check.count()) === 1, '');
    await check.click();
    // The updater answers with progress, "nothing found", "cannot update
    // itself", or its error; any of them is the screen reacting. An unpackaged
    // build has no update feed.
    const reacted = await page
      .getByText(/checking…|downloading|no update was found|cannot update itself|failed|error/i)
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await settle(page);
    await page.screenshot({ path: shot('checked') });
    verdict(
      'Check for updates shows the updater working or its answer',
      reacted,
      (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)
    );
    verdict(
      'after an answer the check is offered again, enabled',
      (await page
        .getByRole('button', { name: /check again/i })
        .isEnabled()
        .catch(() => false)) ||
        (await page.getByRole('button', { name: /checking…|downloading/i }).count()) > 0,
      ''
    );
    // Last: this one quits the app.
    await page.getByRole('button', { name: /download from website/i }).click();
    const quitInTime = await Promise.race([
      quit.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 15_000)),
    ]);
    verdict(
      'Download from the website opens the releases page and quits',
      quitInTime && hits.includes('/releases'),
      `quit=${quitInTime} releases page requested=${hits.includes('/releases')}`
    );
  });

  // The equality boundary: the minimum is exactly this app's version.
  await withApp(APP_VERSION, 'chord-update-supported', async ({ page, rpc }) => {
    await page.getByRole('button', { name: 'Sign in' }).first().waitFor({ timeout: 60_000 });
    await signInShown(page);
    await page.screenshot({ path: shot('supported') });
    const state = await rpc('app.getDesktopCompatibility');
    verdict(
      `main holds supported at the minimum ${APP_VERSION}`,
      state?.state === 'supported' && state.minimum === APP_VERSION,
      JSON.stringify(state ?? null)
    );
    verdict(
      'no update-required screen',
      (await page.getByRole('heading', { name: 'Update required' }).count()) === 0,
      ''
    );
  });

  // No server: unknown never blocks, and the placeholder gives way to sign-in,
  // which says the server could not be reached.
  await withApp(null, 'chord-update-server-down', async ({ page, rpc }) => {
    await page.getByRole('button', { name: 'Sign in' }).first().waitFor({ timeout: 60_000 });
    await signInShown(page);
    await page.screenshot({ path: shot('server-down') });
    const state = await rpc('app.getDesktopCompatibility');
    verdict(
      'server down: main holds a checked unknown and the app reaches sign-in',
      state?.state === 'unknown' && state.checked === true,
      JSON.stringify(state ?? null)
    );
    verdict(
      'server down: sign-in says the sync server could not be reached',
      (await page.getByText(/could not reach the chord sync server/i).count()) === 1,
      ''
    );
  });

  // A server that never answers: the first reading gives up quickly.
  await withApp('silent', 'chord-update-server-silent', async ({ page, rpc, windowAt }) => {
    await page.getByRole('button', { name: 'Sign in' }).first().waitFor({ timeout: 60_000 });
    const waited = Date.now() - windowAt;
    await signInShown(page);
    await page.screenshot({ path: shot('server-silent') });
    const state = await rpc('app.getDesktopCompatibility');
    verdict(
      'silent server: sign-in replaces the placeholder in under 4 s',
      waited < 4_000 && state?.state === 'unknown' && state.checked === true,
      `${waited} ms; ${JSON.stringify(state ?? null)}`
    );
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
