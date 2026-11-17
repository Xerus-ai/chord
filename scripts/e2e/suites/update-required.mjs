/**
 * Live check of the version handshake (devstation-mg6u.2), driven through the
 * real app: the main process reads <CHORD_CLOUD_API_URL>/health and compares
 * the app's version with the server's min_desktop_version.
 *   - a server whose minimum is above the app's version: the app shows the
 *     "Update required" screen naming both versions, and not the workspace;
 *   - a server whose minimum is the app's own version: the app opens normally.
 * Each launch points CHORD_CLOUD_API_URL at a local server answering /health as
 * the sync server does (other paths 404), so the minimum can be set per launch.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/suites/update-required.mjs
 *
 * Screenshots: <e2e out>/screenshots/update-required-NN-*.png.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { launchSeededApp } from '../lib/seeded-app.mjs';

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
  const instance = await launchSeededApp({
    source: 'built',
    profilePrefix,
    env: { CHORD_CLOUD_API_URL: health.url },
  });
  try {
    await check(instance);
  } catch (error) {
    await instance.page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    await instance.close();
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
      'the workspace is not shown',
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
    await page.getByTitle('Settings', { exact: true }).waitFor({ timeout: 60_000 });
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
