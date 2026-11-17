/**
 * Live check of the version handshake (devstation-mg6u.2), driven through the
 * real app: the main process reads <CHORD_CLOUD_API_URL>/health and compares
 * the app's version with the server's min_desktop_version.
 *   - a server whose minimum is above the app's version: the app shows the
 *     "Update required" screen naming both versions, and not the workspace;
 *   - a server whose minimum is below the app's version: the app goes on to its
 *     normal first screen (sign-in, on a fresh profile).
 * Each launch points CHORD_CLOUD_API_URL at a local server answering /health as
 * the sync server does (other paths 404), so the minimum can be set per launch.
 * The handshake comes before the session gates, so each launch is a fresh,
 * signed-out profile: no seed account is needed, and none is spent.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/suites/update-required.mjs
 *
 * Screenshots: <e2e out>/screenshots/update-required-NN-*.png.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { E2E_SHOTS_DIR, E2E_VIDEO_DIR, recordRunOnExit } from '../lib/experience/run-record.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `update-required-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

/** A local /health answering with the given minimum; resolves to { url, close }. */
async function healthServer(minimum) {
  const server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', min_desktop_version: minimum }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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
    },
  });
  const page = await app.firstWindow({ timeout: 90_000 });
  try {
    await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 60_000 });
    const rpc = (channel, ...args) =>
      page.evaluate(([c, a]) => window.electronAPI.invoke(c, ...a), [channel, args]);
    await check({ page, rpc });
  } catch (error) {
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    await app.close();
    rmSync(join(appData, profile), { recursive: true, force: true });
    await health.close();
  }
}

async function main() {
  await withApp('99.0.0', 'chord-update-required', async ({ page, rpc }) => {
    await page.getByRole('heading', { name: 'Update required' }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(400);
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
    verdict(
      'offers the update',
      (await page
        .getByRole('button', { name: /download update|check for updates|open the download page/i })
        .count()) > 0,
      ''
    );
  });

  await withApp('0.0.1', 'chord-update-supported', async ({ page, rpc }) => {
    await page.getByRole('button', { name: 'Sign in' }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('supported') });
    const state = await rpc('app.getDesktopCompatibility');
    verdict('main holds supported', state?.state === 'supported', JSON.stringify(state ?? null));
    verdict(
      'no update-required screen',
      (await page.getByRole('heading', { name: 'Update required' }).count()) === 0,
      ''
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
