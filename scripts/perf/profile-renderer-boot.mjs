/* global document */
/**
 * CPU profile of the renderer booting (a reload of the signed-in app until the
 * sidebar rows show), summarised as self time per script and per function.
 *
 *   node scripts/perf/profile-renderer-boot.mjs <appDir> [top=25]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { E2E_PERF_DIR } from '../e2e/lib/experience/run-record.mjs';
import { launchSeededApp, ROOT } from '../e2e/lib/seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
const top = Number(process.argv[3] ?? 25);
const instance = await launchSeededApp({
  source: 'built',
  appDir,
  profilePrefix: 'chord-perf-prof',
});
try {
  const { page } = instance;
  await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('[data-sidebar-row]'), null, {
    timeout: 60_000,
  });
  const { profile } = await cdp.send('Profiler.stop');
  mkdirSync(E2E_PERF_DIR, { recursive: true });
  writeFileSync(
    join(E2E_PERF_DIR, 'renderer-boot.cpuprofile'),
    JSON.stringify(profile)
  );
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
  const byFn = new Map();
  const byUrl = new Map();
  for (const [id, us] of self) {
    const { callFrame } = byId.get(id);
    const url = callFrame.url.split('/').pop() || `(${callFrame.functionName || 'program'})`;
    const fn = `${callFrame.functionName || '(anon)'} ${url}:${callFrame.lineNumber}`;
    byFn.set(fn, (byFn.get(fn) ?? 0) + us);
    byUrl.set(url, (byUrl.get(url) ?? 0) + us);
  }
  const show = (m) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([k, us]) => `${String(Math.round(us / 1000)).padStart(6)} ms  ${k}`)
      .join('\n');
  console.log(
    `total ${Math.round((profile.endTime - profile.startTime) / 1000)} ms\n--- by script\n${show(byUrl)}\n--- by function\n${show(byFn)}`
  );
} finally {
  await instance.close();
}
