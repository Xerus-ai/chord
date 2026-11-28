/**
 * Live check for feature flags (devstation-mg6u.90), driven through the real packaged app:
 * the sync server's /health names which flags are on, and Settings > General > Preview features
 * shows each registered flag as the server left it. Two launches of a signed-in seeded profile:
 *   - the server serves whats_new on: the What's new row reads On;
 *   - the server serves it off: the row reads Off.
 * The app's sync server URL points at a local stand-in that answers /health with the flags and
 * forwards every other request (and socket upgrade) to the real sync server, so sign-in holds.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/suites/feature-flags.mjs
 *
 * Screenshots: <e2e out>/screenshots/feature-flags-NN-*.png.
 */
import { mkdirSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { request as requestTls } from 'node:https';
import { connect } from 'node:net';
import { join } from 'node:path';
import { connect as connectTls } from 'node:tls';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { launchSeededApp } from '../lib/seeded-app.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `feature-flags-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

/** The real sync server (from the repo .env, which launchSeededApp loads). */
function upstream() {
  const raw = process.env.CHORD_CLOUD_API_URL;
  if (!raw)
    throw new Error('CHORD_CLOUD_API_URL is not set: the seeded app needs the real sync server');
  return new URL(raw.endsWith('/') ? raw : `${raw}/`);
}

/** A stand-in sync server: /health with `flags`, everything else forwarded upstream. */
async function flagServer(flags) {
  const real = upstream();
  const tls = real.protocol === 'https:';
  const prefix = real.pathname.replace(/\/$/, '');
  // The stand-in serves the real answer with the flags swapped in: unread, the run would test
  // a made-up /health, so it stops here instead.
  const answer = await fetch(new URL('health', real));
  if (!answer.ok) throw new Error(`the real sync server's /health answered ${answer.status}`);
  const realHealth = await answer.json();
  const server = createServer((req, res) => {
    if ((req.url ?? '/').split('?')[0] === '/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...realHealth, flags }));
      return;
    }
    const forward = (tls ? requestTls : request)(
      {
        host: real.hostname,
        port: real.port || (tls ? 443 : 80),
        method: req.method,
        path: `${prefix}${req.url}`,
        headers: { ...req.headers, host: real.host },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    forward.on('error', (error) => {
      console.log(`forwarding ${req.method} ${req.url} failed: ${String(error)}`);
      // Headers already sent: the response can only be cut off.
      if (res.headersSent) res.destroy(error);
      else res.writeHead(502).end();
    });
    req.pipe(forward);
  });
  server.on('upgrade', (req, socket, head) => {
    const port = Number(real.port || (tls ? 443 : 80));
    const target = tls
      ? connectTls({ host: real.hostname, port, servername: real.hostname })
      : connect({ host: real.hostname, port });
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
    target.once(tls ? 'secureConnect' : 'connect', () => {
      const headers = { ...req.headers, host: real.host };
      const lines = [`${req.method} ${prefix}${req.url} HTTP/1.1`];
      for (const [key, value] of Object.entries(headers)) {
        for (const v of [value].flat()) lines.push(`${key}: ${v}`);
      }
      target.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Opens Settings > General and reads the What's new row of Preview features. */
async function readWhatsNew(page, name) {
  await page.getByTitle('Settings', { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByTitle('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Back to app' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'General', exact: true }).first().click();
  const card = page.locator('#settings-card-preview-features');
  await card.waitFor({ timeout: 15_000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot(name) });
  // The card alone: the full window shows the seed account, which a public PR must not.
  await card.screenshot({ path: shot(`${name}-card`) });
  const row = card.getByTestId('feature-flag-whats_new');
  return {
    title: await row.getByText("What's new").count(),
    state: await row.getAttribute('data-state'),
  };
}

async function launchWith(flags, name) {
  const stub = await flagServer(flags);
  const instance = await launchSeededApp({
    source: 'built',
    profilePrefix: `chord-feature-flags-${name}`,
    env: { CHORD_CLOUD_API_URL: stub.url },
  });
  try {
    return await readWhatsNew(instance.page, name);
  } catch (error) {
    await instance.page.screenshot({ path: shot(`${name}-failure`) });
    throw error;
  } finally {
    await instance.close();
    await stub.close();
  }
}

async function main() {
  const on = await launchWith({ whats_new: true }, 'served-on');
  verdict(
    "the server serves whats_new on: What's new reads On",
    on.title === 1 && on.state === 'on',
    `row title found ${on.title}, state ${on.state}`
  );

  const off = await launchWith({ whats_new: false }, 'served-off');
  verdict(
    "the server serves whats_new off: What's new reads Off",
    off.title === 1 && off.state === 'off',
    `row title found ${off.title}, state ${off.state}`
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
