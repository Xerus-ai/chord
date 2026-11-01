/* global document, requestAnimationFrame -- evaluate callbacks run in the app window */
/**
 * Cold-start benchmark for a built app (`node scripts/e2e/build-e2e-app.mjs <dir>`).
 * Launches it RUNS times under a seeded, signed-in profile, each time cold (a
 * fresh profile) and then warm (the same profile relaunched), and reports, per
 * launch and as medians per kind, milliseconds from main-process start to:
 *   window   — the first BrowserWindow exists
 *   dcl      — renderer DOMContentLoaded
 *   shell    — the app shell is on screen (the sidebar's Dashboard button)
 *   rows     — the sidebar shows its work items
 *   stats    — a sidebar row shows its git diff stats (the summaries query landed)
 *
 *   node scripts/perf/bench-startup.mjs <appDir> [runs=5] [label]
 *
 * Results append to .e2e-runs/perf/startup.jsonl so before/after runs compare.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { launchSeededApp, ROOT } from '../e2e/seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
const runs = Number(process.argv[3] ?? 5);
const label = process.argv[4] ?? appDir;

// The heavy profile (scripts/perf/seed-heavy-history.py) for every bench: the
// seeds are copies of one sign-in, and WorkOS rotates its refresh token, so
// only the profile the benches keep handing the session back to stays live.
const SEED = process.env.CHORD_PERF_SEED ?? 'chord-perf-heavy';
const SHELL = 'button[aria-label="Dashboard"]';
const ROW = '[data-sidebar-row]';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Times one launch, from main-process start, of an app `instance` just launched. */
async function measureLaunch(instance, i, kind) {
  const { app, page } = instance;
  // Main-process start in epoch ms, read from main itself.
  const mainStart = await app.evaluate(() => Date.now() - process.uptime() * 1000);
  // Watch from inside the page, one check per frame, so each time is the
  // frame the element first appeared rather than a later round trip.
  const marks = await page.evaluate(
    ([shellSel, rowSel]) =>
      new Promise((done, fail) => {
        const seen = {};
        const deadline = performance.now() + 60_000;
        const tick = () => {
          const now = performance.now();
          if (seen.shell === undefined && document.querySelector(shellSel)) seen.shell = now;
          if (seen.rows === undefined && document.querySelector(rowSel)) seen.rows = now;
          if (
            seen.stats === undefined &&
            [...document.querySelectorAll(rowSel)].some((r) => /\+\d+\s*-\d+/.test(r.textContent))
          )
            seen.stats = now;
          if (seen.shell !== undefined && seen.rows !== undefined && seen.stats !== undefined) {
            const nav = performance.getEntriesByType('navigation')[0];
            const fcp = performance.getEntriesByName('first-contentful-paint')[0];
            done({
              origin: performance.timeOrigin,
              dcl: nav ? nav.domContentLoadedEventEnd : null,
              fcp: fcp ? fcp.startTime : null,
              shell: seen.shell,
              rows: seen.rows,
              stats: seen.stats,
              rowCount: document.querySelectorAll(rowSel).length,
            });
            return;
          }
          if (now > deadline) fail(new Error(`not seen in 60s: ${JSON.stringify(seen)}`));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    [SHELL, ROW]
  );
  // Main's own milestones (main/app/boot-timing.ts), when the build has them.
  const bootLine = instance
    .readStdout()
    .split('\n')
    .find((line) => line.startsWith('[boot] '));
  const boot = bootLine ? JSON.parse(bootLine.slice('[boot] '.length)) : null;
  const rel = (rendererMs) => Math.round(marks.origin + rendererMs - mainStart);
  const result = {
    run: i,
    kind,
    window: Math.round(marks.origin - mainStart),
    dcl: marks.dcl === null ? null : rel(marks.dcl),
    fcp: marks.fcp === null ? null : rel(marks.fcp),
    shell: rel(marks.shell),
    rowsVisible: rel(marks.rows),
    statsVisible: rel(marks.stats),
    rowCount: marks.rowCount,
    boot,
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * A cold launch (a fresh profile: no code cache, no HTTP cache) and then a
 * warm one (the same profile again, as every launch after the first is).
 */
async function measureOnce(i) {
  const cold = await launchSeededApp({
    source: 'built',
    appDir,
    seedProfile: SEED,
    profilePrefix: 'chord-perf-startup',
  });
  let coldResult;
  try {
    coldResult = await measureLaunch(cold, i, 'cold');
  } finally {
    await cold.close({ keepProfile: true });
  }
  const warm = await launchSeededApp({
    source: 'built',
    appDir,
    seedProfile: SEED,
    reopenProfile: basename(cold.profileDir),
  });
  try {
    return [coldResult, await measureLaunch(warm, i, 'warm')];
  } finally {
    await warm.close();
  }
}

const results = [];
for (let i = 0; i < runs; i++) results.push(...(await measureOnce(i)));
const summary = { label, runs, at: new Date().toISOString() };
for (const kind of ['cold', 'warm']) {
  const ofKind = results.filter((r) => r.kind === kind);
  summary[kind] = {};
  for (const key of ['window', 'dcl', 'fcp', 'shell', 'rowsVisible', 'statsVisible']) {
    summary[kind][key] = median(ofKind.map((r) => r[key]).filter((v) => v !== null));
  }
}
console.log('MEDIAN', JSON.stringify(summary));
const outDir = join(ROOT, '.e2e-runs', 'perf');
mkdirSync(outDir, { recursive: true });
appendFileSync(join(outDir, 'startup.jsonl'), JSON.stringify({ ...summary, results }) + '\n');
