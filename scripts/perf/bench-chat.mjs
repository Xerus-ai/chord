/* global document, requestAnimationFrame -- evaluate callbacks run in the app window */
/**
 * Chat benchmark on the heavy profile (`python scripts/perf/seed-heavy-history.py`):
 *   open     — click the work item's largest session in the rail → its transcript shows rows
 *   scroll   — scroll the transcript from the newest message to the oldest at a
 *              steady 600px per frame: frame times (p50/p95/max), frames over
 *              50ms, long tasks, and ms until the oldest row is on screen
 *   reopen   — switch to another work item and back → its transcript shows rows again
 *
 *   node scripts/perf/bench-chat.mjs <appDir> [runs=3] [label] [workItemName=raghav] [otherName="test work item"]
 *
 * Results append to <e2e out>/perf/chat.jsonl.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { E2E_PERF_DIR } from '../e2e/lib/experience/run-record.mjs';
import { launchSeededApp, ROOT } from '../e2e/lib/seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
const runs = Number(process.argv[3] ?? 3);
const label = process.argv[4] ?? appDir;
const itemName = process.argv[5] ?? 'raghav';
const otherName = process.argv[6] ?? 'test work item';

const TRANSCRIPT = '[data-testid="chat-transcript"]';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Clicks the sidebar row named `name`. */
async function selectItem(page, name) {
  await page.locator('[data-sidebar-row]', { hasText: name }).first().click();
  await page.getByRole('tab', { name: 'Work item' }).click();
  await page
    .getByText(/\d+ msgs/)
    .first()
    .waitFor({ timeout: 30_000 });
}

/**
 * Clicks the work item rail's session with the most messages and returns ms
 * until its transcript shows rows — opening an old conversation.
 */
async function openLargestSession(page) {
  return page.evaluate(
    (sel) =>
      new Promise((done, fail) => {
        const counts = [...document.querySelectorAll('button')]
          .filter((e) => /\d+ msgs/.test(e.textContent))
          .map((e) => ({ e, n: Number(e.textContent.match(/(\d+) msgs/)[1]) }))
          .sort((a, b) => b.n - a.n);
        const target = counts[0]?.e;
        if (!target) {
          fail(new Error('no session row with a message count'));
          return;
        }
        const t0 = performance.now();
        target.click();
        const deadline = t0 + 30_000;
        const tick = () => {
          const t = [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null);
          if (t && t.querySelector('[data-index]')) {
            done(Math.round(performance.now() - t0));
            return;
          }
          if (performance.now() > deadline) fail(new Error('transcript never showed rows'));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    TRANSCRIPT
  );
}

/**
 * Clicks sidebar row `name` (a real click, through Playwright) and returns ms
 * from that click to a visible transcript with rows. The timer starts in the
 * page on the click event itself.
 */
async function reopenItem(page, name) {
  const watching = page.evaluate(
    (sel) =>
      new Promise((done, fail) => {
        document.addEventListener(
          'click',
          () => {
            const t0 = performance.now();
            const deadline = t0 + 30_000;
            const tick = () => {
              const t = [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null);
              if (t && t.querySelector('[data-index]')) {
                done(Math.round(performance.now() - t0));
                return;
              }
              if (performance.now() > deadline)
                fail(new Error('reopened transcript never showed rows'));
              else requestAnimationFrame(tick);
            };
            tick();
          },
          { capture: true, once: true }
        );
      }),
    TRANSCRIPT
  );
  await page.locator('[data-sidebar-row]', { hasText: name }).first().click();
  return watching;
}

/** Scrolls the visible transcript to its oldest row, measuring every frame. */
async function scrollToOldest(page) {
  return page.evaluate(
    (sel) =>
      new Promise((done) => {
        const el = [...document.querySelectorAll(sel)].find((t) => t.offsetParent !== null);
        const longTasks = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        observer.observe({ entryTypes: ['longtask'] });
        el.scrollTop = el.scrollHeight;
        const frames = [];
        let last = performance.now();
        const t0 = last;
        let settled = 0;
        const step = () => {
          const now = performance.now();
          frames.push(now - last);
          last = now;
          const first = el.querySelector('[data-index="0"]');
          if (el.scrollTop <= 0 && first) {
            // The oldest row is mounted; hold a few frames for its measure.
            if (++settled > 3) {
              observer.disconnect();
              const sorted = [...frames].sort((a, b) => a - b);
              const pct = (p) => Math.round(sorted[Math.floor(sorted.length * p)] * 10) / 10;
              done({
                toOldest: Math.round(now - t0),
                frames: frames.length,
                p50: pct(0.5),
                p95: pct(0.95),
                max: Math.round(sorted[sorted.length - 1]),
                over50: frames.filter((f) => f > 50).length,
                longTasks: longTasks.length,
                longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
                rows: el.querySelectorAll('[data-index]').length,
              });
              return;
            }
          }
          el.scrollTop = Math.max(0, el.scrollTop - 600);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    TRANSCRIPT
  );
}

async function measureOnce(i) {
  const instance = await launchSeededApp({
    source: 'built',
    appDir,
    seedProfile: 'chord-perf-heavy',
    profilePrefix: 'chord-perf-chat',
  });
  try {
    const { page } = instance;
    await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
    // Let boot-time work settle so the open is measured on a quiet app.
    await page.waitForTimeout(3000);
    await selectItem(page, itemName);
    await page.waitForTimeout(1500);
    const open = await openLargestSession(page).catch(async (error) => {
      const shot = join(E2E_PERF_DIR, `chat-open-failed-${Date.now()}.png`);
      await page.screenshot({ path: shot });
      throw new Error(`${error.message} (screenshot ${shot})`);
    });
    await page.waitForTimeout(1500);
    const scroll = await scrollToOldest(page);
    await page.locator('[data-sidebar-row]', { hasText: otherName }).first().click();
    // The other item is on screen once no transcript of the first is visible.
    await page.waitForFunction(
      (sel) => ![...document.querySelectorAll(sel)].some((t) => t.offsetParent !== null),
      TRANSCRIPT,
      { timeout: 30_000 }
    );
    await page.waitForTimeout(1500);
    const reopen = await reopenItem(page, itemName).catch(async (error) => {
      const shot = join(E2E_PERF_DIR, `chat-reopen-failed-${Date.now()}.png`);
      await page.screenshot({ path: shot });
      throw new Error(`${error.message} (screenshot ${shot})`);
    });
    const result = { run: i, open, reopen, ...scroll };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await instance.close();
  }
}

const results = [];
for (let i = 0; i < runs; i++) results.push(await measureOnce(i));
const summary = { label, runs, at: new Date().toISOString() };
for (const key of ['open', 'reopen', 'toOldest', 'p50', 'p95', 'max', 'over50', 'longTaskMs']) {
  summary[key] = median(results.map((r) => r[key]));
}
console.log('MEDIAN', JSON.stringify(summary));
const outDir = E2E_PERF_DIR;
mkdirSync(outDir, { recursive: true });
appendFileSync(join(outDir, 'chat.jsonl'), JSON.stringify({ ...summary, results }) + '\n');
