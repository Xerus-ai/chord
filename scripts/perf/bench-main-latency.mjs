/* global window -- evaluate callbacks run in the app window */
/**
 * Main-process responsiveness: every RPC, chat load and asset the renderer
 * asks for waits behind whatever holds main's thread (a process spawn on
 * Windows holds it ~25ms). On the heavy profile, after boot settles, a cheap
 * RPC is sent every 20ms for WINDOW seconds while the user switches between
 * two work items every 4s, and its round trips are reported: p50, p95, max,
 * and how many took over 50ms.
 *
 *   node scripts/perf/bench-main-latency.mjs <appDir> [runs=2] [label] [seconds=24]
 *
 * Results append to <e2e out>/perf/main-latency.jsonl.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { E2E_PERF_DIR } from '../e2e/lib/experience/run-record.mjs';
import { launchSeededApp, ROOT } from '../e2e/lib/seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
const runs = Number(process.argv[3] ?? 2);
const label = process.argv[4] ?? appDir;
const seconds = Number(process.argv[5] ?? 24);
const ITEMS = ['raghav', 'testing'];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measureOnce(i) {
  const instance = await launchSeededApp({
    source: 'built',
    appDir,
    seedProfile: 'chord-perf-heavy',
    profilePrefix: 'chord-perf-latency',
  });
  try {
    const { page } = instance;
    await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
    await page.waitForTimeout(5000);
    const sampling = page.evaluate(
      (ms) =>
        new Promise((done) => {
          const samples = [];
          const end = performance.now() + ms;
          const ping = () => {
            const t0 = performance.now();
            window.electronAPI.invoke('viewState.get', 'right-rail').then(() => {
              const now = performance.now();
              samples.push(now - t0);
              if (now > end) done(samples);
              else setTimeout(ping, 20);
            });
          };
          ping();
        }),
      seconds * 1000
    );
    for (let s = 0; s < seconds / 4; s++) {
      await page
        .locator('[data-sidebar-row]', { hasText: ITEMS[s % ITEMS.length] })
        .first()
        .click();
      await page.waitForTimeout(4000);
    }
    const samples = await sampling;
    const sorted = [...samples].sort((a, b) => a - b);
    const pct = (p) => Math.round(sorted[Math.floor(sorted.length * p)] * 10) / 10;
    const result = {
      run: i,
      samples: samples.length,
      p50: pct(0.5),
      p95: pct(0.95),
      max: Math.round(sorted[sorted.length - 1]),
      over50: samples.filter((v) => v > 50).length,
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await instance.close();
  }
}

const results = [];
for (let i = 0; i < runs; i++) results.push(await measureOnce(i));
const summary = { label, runs, seconds, at: new Date().toISOString() };
for (const key of ['p50', 'p95', 'max', 'over50'])
  summary[key] = median(results.map((r) => r[key]));
console.log('MEDIAN', JSON.stringify(summary));
const outDir = E2E_PERF_DIR;
mkdirSync(outDir, { recursive: true });
appendFileSync(join(outDir, 'main-latency.jsonl'), JSON.stringify({ ...summary, results }) + '\n');
