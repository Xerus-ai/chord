/**
 * Every process main starts while the user works, and how long each start held
 * main's thread (process creation is synchronous on Windows). On the heavy
 * profile, after boot settles, `ChildProcess.prototype.spawn` is wrapped inside
 * main, the user switches between two work items every 4s for SECONDS, and
 * the spawns are reported by command: count and total ms of main thread held.
 *
 *   node scripts/perf/bench-spawns.mjs <appDir> [label] [seconds=24]
 *   CHORD_PERF_IDLE=1 node scripts/perf/bench-spawns.mjs …   (no clicks: what polling alone costs)
 *
 * Results append to .e2e-runs/perf/spawns.jsonl.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchSeededApp, ROOT } from '../e2e/lib/seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
const label = process.argv[3] ?? appDir;
const seconds = Number(process.argv[4] ?? 24);
const ITEMS = ['raghav', 'testing'];

const instance = await launchSeededApp({
  source: 'built',
  appDir,
  seedProfile: 'chord-perf-heavy',
  profilePrefix: 'chord-perf-spawns',
});
try {
  const { app, page } = instance;
  await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
  await page.waitForTimeout(5000);
  await app.evaluate(() => {
    const { ChildProcess } = process.getBuiltinModule('node:child_process');
    const original = ChildProcess.prototype.spawn;
    globalThis.__perfSpawns = [];
    ChildProcess.prototype.spawn = function spawnTimed(options) {
      const t0 = performance.now();
      try {
        return original.call(this, options);
      } finally {
        const args = options.args ?? [];
        const file = String(options.file ?? '')
          .split(/[\\/]/)
          .pop();
        // `git -C <dir> <verb>` and `cmd /c <cmd>`: name the verb, not the wrapper.
        const verb = args.slice(1).find((a) => !String(a).startsWith('-') && !/[\\/:]/.test(a));
        globalThis.__perfSpawns.push({
          cmd: `${file} ${verb ?? ''}`.trim(),
          ms: performance.now() - t0,
        });
      }
    };
  });
  if (process.env.CHORD_PERF_IDLE) {
    await page.waitForTimeout(seconds * 1000);
  } else {
    for (let s = 0; s < seconds / 4; s++) {
      await page
        .locator('[data-sidebar-row]', { hasText: ITEMS[s % ITEMS.length] })
        .first()
        .click();
      await page.waitForTimeout(4000);
    }
  }
  const spawns = await app.evaluate(() => globalThis.__perfSpawns);
  const byCmd = {};
  for (const { cmd, ms } of spawns) {
    byCmd[cmd] ??= { count: 0, ms: 0 };
    byCmd[cmd].count += 1;
    byCmd[cmd].ms += ms;
  }
  const top = Object.entries(byCmd)
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([cmd, v]) => ({ cmd, count: v.count, ms: Math.round(v.ms) }));
  const summary = {
    label,
    seconds,
    at: new Date().toISOString(),
    spawns: spawns.length,
    heldMs: Math.round(spawns.reduce((a, b) => a + b.ms, 0)),
    top: top.slice(0, 12),
  };
  console.log('RESULT', JSON.stringify(summary));
  const outDir = join(ROOT, '.e2e-runs', 'perf');
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, 'spawns.jsonl'), JSON.stringify(summary) + '\n');
} finally {
  await instance.close();
}
