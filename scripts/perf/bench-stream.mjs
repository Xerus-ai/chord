/* global document, requestAnimationFrame -- evaluate callbacks run in the app window */
/**
 * Streaming benchmark on the heavy profile (`python scripts/perf/seed-heavy-history.py`):
 * the 1,280-row session is open at its newest message, and main sends the
 * renderer a synthetic agent reply the way a session bridge does
 * (`turn-stream.<workItemId>`: turn_started, item_added, then item_updated
 * every 33ms with the text grown by one chunk — markdown with code blocks —
 * up to ~25 KB). The renderer's frames and long tasks are recorded while it
 * streams: what scrolling and typing feel like while an agent answers. `pinned`
 * says whether a reader at the bottom when it started is still at the bottom.
 *
 *   node scripts/perf/bench-stream.mjs <appDir> [runs=3] [label]
 *
 * Results append to .e2e-runs/perf/stream.jsonl.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchSeededApp, ROOT } from '../e2e/lib/seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
const runs = Number(process.argv[3] ?? 3);
const label = process.argv[4] ?? appDir;
const ITEM = 'raghav';
const TRANSCRIPT = '[data-testid="chat-transcript"]';
const UPDATES = 240;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The reply's text after `n` chunks: paragraphs, lists and code fences. */
function replyChunks() {
  const chunks = [];
  for (let i = 0; i < UPDATES; i++) {
    if (i % 24 === 8) chunks.push('\n\n```ts\n');
    else if (i % 24 === 16) chunks.push('\n```\n\n');
    else if (i % 24 > 8 && i % 24 < 16)
      chunks.push(`const value${i} = compute(${i}, { retries: ${i % 5} });\n`);
    else if (i % 12 === 0) chunks.push(`\n\n## Step ${i / 12 + 1}\n\n- point one about ${i}\n`);
    else
      chunks.push(`The change keeps item ${i} consistent with the stored state and its callers. `);
  }
  return chunks;
}

async function measureOnce(i) {
  const instance = await launchSeededApp({
    source: 'built',
    appDir,
    seedProfile: 'chord-perf-heavy',
    profilePrefix: 'chord-perf-stream',
  });
  try {
    const { app, page, rpc } = instance;
    await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
    await page.waitForTimeout(3000);
    const workItem = (await rpc('workItems.getAll')).data.items.find((w) => w.name === ITEM);
    const session = (await rpc('agentSessions.getAll', workItem.id)).data.sessions.find(
      (s) => s.title === ITEM && s.kind === 'chat'
    );
    await page.locator('[data-sidebar-row]', { hasText: ITEM }).first().click();
    await page.getByRole('tab', { name: 'Work item' }).click();
    await page
      .getByRole('button', { name: /\d{3,} msgs/ })
      .first()
      .click();
    await page.waitForFunction(
      (sel) =>
        [...document.querySelectorAll(sel)].some(
          (t) => t.offsetParent !== null && t.querySelector('[data-index]')
        ),
      TRANSCRIPT,
      { timeout: 30_000 }
    );
    await page.waitForTimeout(2000);

    const watching = page.evaluate(
      ([sel, ms]) =>
        new Promise((done) => {
          const el = [...document.querySelectorAll(sel)].find((t) => t.offsetParent !== null);
          el.scrollTop = el.scrollHeight;
          const longTasks = [];
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
          });
          observer.observe({ entryTypes: ['longtask'] });
          const frames = [];
          let last = performance.now();
          const end = last + ms;
          const tick = () => {
            const now = performance.now();
            frames.push(now - last);
            last = now;
            if (now < end) {
              requestAnimationFrame(tick);
              return;
            }
            observer.disconnect();
            const sorted = [...frames].sort((a, b) => a - b);
            const pct = (p) => Math.round(sorted[Math.floor(sorted.length * p)] * 10) / 10;
            done({
              frames: frames.length,
              p50: pct(0.5),
              p95: pct(0.95),
              max: Math.round(sorted[sorted.length - 1]),
              over50: frames.filter((f) => f > 50).length,
              longTasks: longTasks.length,
              longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
            });
          };
          requestAnimationFrame(tick);
        }),
      [TRANSCRIPT, UPDATES * 33 + 1500]
    );

    await app.evaluate(
      ({ BrowserWindow }, { workItemId, sessionId, chunks }) => {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
        const channel = `turn-stream.${workItemId}`;
        const turnId = `perf-turn-${Date.now()}`;
        const itemId = `perf-item-${Date.now()}`;
        const send = (action) =>
          win.webContents.send(channel, { workItemId, turnId, sessionId, action });
        send({ type: 'turn_started', agentName: 'Claude Code', timestamp: Date.now() });
        send({ type: 'item_added', item: { kind: 'text', id: itemId, text: '' } });
        let text = '';
        let n = 0;
        const timer = setInterval(() => {
          text += chunks[n];
          send({ type: 'item_updated', itemId, item: { kind: 'text', id: itemId, text } });
          if (++n === chunks.length) {
            clearInterval(timer);
            send({ type: 'turn_completed', timestamp: Date.now() });
          }
        }, 33);
      },
      { workItemId: workItem.id, sessionId: session.id, chunks: replyChunks() }
    );
    const measured = await watching;
    // The reply must have rendered in full, or the frames say nothing about it.
    const shown = await page
      .waitForFunction(
        ([sel, last]) =>
          [...document.querySelectorAll(sel)].some(
            (t) => t.offsetParent !== null && t.textContent.includes(last)
          ),
        [TRANSCRIPT, `value${UPDATES - 9}`],
        { timeout: 15_000 }
      )
      .then(
        () => true,
        () => false
      );
    if (!shown) {
      const shot = join(ROOT, '.e2e-runs', 'perf', `stream-not-shown-${Date.now()}.png`);
      await page.screenshot({ path: shot });
      throw new Error(`the streamed reply never rendered in the transcript (screenshot ${shot})`);
    }
    // A reader at the bottom when the reply started is still at the bottom
    // after it grew: the transcript follows streamed text, not only new rows.
    const pinned = await page.evaluate((sel) => {
      const el = [...document.querySelectorAll(sel)].find((t) => t.offsetParent !== null);
      return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    }, TRANSCRIPT);
    const result = { run: i, pinned, ...measured };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await instance.close();
  }
}

const results = [];
for (let i = 0; i < runs; i++) results.push(await measureOnce(i));
const summary = { label, runs, at: new Date().toISOString() };
for (const key of ['p50', 'p95', 'max', 'over50', 'longTasks', 'longTaskMs']) {
  summary[key] = median(results.map((r) => r[key]));
}
console.log('MEDIAN', JSON.stringify(summary));
const outDir = join(ROOT, '.e2e-runs', 'perf');
mkdirSync(outDir, { recursive: true });
appendFileSync(join(outDir, 'stream.jsonl'), JSON.stringify({ ...summary, results }) + '\n');
