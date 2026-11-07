/* global document */
/**
 * The surfaces the performance work changed (devstation-t0kl), driven through
 * the real UI of a built app on the heavy profile
 * (`python scripts/perf/seed-heavy-history.py`: 1,280 rows on one session):
 *   - the signed-in shell comes up with its sidebar;
 *   - an old 1,280-row session opens at its newest message and scrolls to its
 *     oldest one;
 *   - a streamed agent reply keeps a reader at the bottom pinned there, and its
 *     code block is highlighted (grammars now load on first use);
 *   - a file diff renders in Monaco (Monaco now loads on first use);
 *   - a markdown artifact opens in the document editor (now its own chunk).
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-perf-final CHORD_E2E_VIDEO=1 node scripts/e2e/suites/perf-surfaces.mjs
 *
 * Screenshots: screenshots/e2e/perf-surfaces-*.png.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { launchSeededApp } from '../lib/seeded-app.mjs';

mkdirSync(E2E_SHOTS_DIR, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(E2E_SHOTS_DIR, `perf-surfaces-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const TRANSCRIPT = '[data-testid="chat-transcript"]';
const HEAVY_ITEM = 'raghav';
const ARTIFACT_ITEM = 'Inspecting architecture';
// One whose file is on disk in the heavy profile (production.md there is not).
const ARTIFACT = 'CHEATSHEET.md';

/** The visible transcript's scroll state. */
const readTranscript = (page) =>
  page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((t) => t.offsetParent !== null);
    if (!el) return null;
    return {
      rows: el.querySelectorAll('[data-index]').length,
      atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 50,
      firstRowShown: !!el.querySelector('[data-index="0"]'),
    };
  }, TRANSCRIPT);

/** Resolves true when `selector` appears within `timeout`, false when it does not. */
const appears = (page, selector, timeout) =>
  page.waitForSelector(selector, { timeout }).then(
    () => true,
    () => false
  );

const instance = await launchSeededApp({
  source: 'built',
  seedProfile: 'chord-perf-heavy',
  profilePrefix: 'chord-e2e-perf-surfaces',
});
const { app, page, rpc } = instance;
try {
  await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
  const rowCount = await page.locator('[data-sidebar-row]').count();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('shell') });
  verdict('the signed-in shell shows the sidebar', rowCount > 0, `${rowCount} sidebar rows`);

  // An old, long session: newest message first, then all the way up.
  await page.locator('[data-sidebar-row]', { hasText: HEAVY_ITEM }).first().click();
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
  await page.waitForTimeout(1000);
  const opened = await readTranscript(page);
  await page.screenshot({ path: shot('old-session-newest') });
  verdict(
    'the 1,280-row session opens at its newest message',
    opened.atBottom && opened.rows > 0,
    `${opened.rows} rows mounted, at bottom: ${opened.atBottom}`
  );

  for (let i = 0; i < 400; i++) {
    const reachedTop = await page.evaluate((sel) => {
      const el = [...document.querySelectorAll(sel)].find((t) => t.offsetParent !== null);
      el.scrollTop = Math.max(0, el.scrollTop - 4000);
      return el.scrollTop === 0 && !!el.querySelector('[data-index="0"]');
    }, TRANSCRIPT);
    if (reachedTop) break;
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(800);
  const top = await readTranscript(page);
  await page.screenshot({ path: shot('old-session-oldest') });
  verdict(
    'scrolling up reaches the oldest message',
    top.firstRowShown,
    `first row mounted: ${top.firstRowShown}`
  );

  // A streamed reply, sent the way a session bridge sends one.
  await page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((t) => t.offsetParent !== null);
    el.scrollTop = el.scrollHeight;
  }, TRANSCRIPT);
  await page.waitForTimeout(800);
  const workItem = (await rpc('workItems.getAll')).data.items.find((w) => w.name === HEAVY_ITEM);
  const session = (await rpc('agentSessions.getAll', workItem.id)).data.sessions.find(
    (s) => s.title === HEAVY_ITEM && s.kind === 'chat'
  );
  await app.evaluate(
    ({ BrowserWindow }, { workItemId, sessionId }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const channel = `turn-stream.${workItemId}`;
      const turnId = `e2e-perf-turn-${Date.now()}`;
      const itemId = `e2e-perf-item-${Date.now()}`;
      const send = (action) =>
        win.webContents.send(channel, { workItemId, turnId, sessionId, action });
      const parts = ['Here is the change.\n\n'];
      for (let i = 0; i < 40; i++) {
        parts.push(`Paragraph ${i} explains one more step of the change in plain words. `);
        if (i % 10 === 9) parts.push('\n\n');
      }
      parts.push(
        '```ts\nexport function sum(a: number, b: number): number {\n  return a + b;\n}\n```\n\nDone: perf-surfaces-end.'
      );
      send({ type: 'turn_started', agentName: 'Claude Code', timestamp: Date.now() });
      send({ type: 'item_added', item: { kind: 'text', id: itemId, text: '' } });
      let text = '';
      let n = 0;
      const timer = setInterval(() => {
        text += parts[n];
        send({ type: 'item_updated', itemId, item: { kind: 'text', id: itemId, text } });
        if (++n === parts.length) clearInterval(timer);
      }, 40);
    },
    { workItemId: workItem.id, sessionId: session.id }
  );
  await page.waitForFunction(
    (sel) =>
      [...document.querySelectorAll(sel)].some(
        (t) => t.offsetParent !== null && t.textContent.includes('perf-surfaces-end')
      ),
    TRANSCRIPT,
    { timeout: 30_000 }
  );
  // The ts grammar arrives as its own chunk; the block is plain until then.
  const highlighted = await page
    .waitForFunction(
      (sel) => {
        const el = [...document.querySelectorAll(sel)].find((t) => t.offsetParent !== null);
        return [...el.querySelectorAll('code span')].some((s) => s.textContent === 'function');
      },
      TRANSCRIPT,
      { timeout: 10_000 }
    )
    .then(
      () => true,
      () => false
    );
  await page.waitForTimeout(500);
  const streamed = await readTranscript(page);
  await page.screenshot({ path: shot('streamed-reply') });
  verdict(
    'a reader at the bottom stays there while the reply streams',
    streamed.atBottom,
    `at bottom after the reply: ${streamed.atBottom}`
  );
  verdict(
    'the reply’s code block is highlighted',
    highlighted,
    `keyword token found: ${highlighted}`
  );

  // A diff in Monaco, which no longer loads with the app.
  await page.getByRole('tab', { name: /^Changes/ }).click();
  await page.getByText('.gitignore', { exact: true }).first().click();
  const diffShown = await appears(page, '.monaco-diff-editor .view-lines', 30_000);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('monaco-diff') });
  verdict(
    'a changed file opens in the Monaco diff',
    diffShown,
    `diff editor rendered: ${diffShown}`
  );

  // A markdown artifact in the document editor, now a chunk of its own.
  await page.locator('[data-sidebar-row]', { hasText: ARTIFACT_ITEM }).first().click();
  await page.getByRole('tab', { name: 'Work item' }).click();
  await page.getByText(ARTIFACT, { exact: true }).first().click();
  // The document itself on screen, not the workspace's error banner.
  const editorShown = await page
    .waitForFunction(
      () => {
        const body = document.querySelector('[data-testid="path-tab-body"]');
        const editor = body?.querySelector('.ProseMirror');
        return (
          !!editor &&
          editor.getClientRects().length > 0 &&
          editor.textContent.trim().length > 0 &&
          !body.textContent.includes('Could not read')
        );
      },
      null,
      { timeout: 30_000 }
    )
    .then(
      () => true,
      () => false
    );
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('artifact-editor') });
  verdict(
    'a markdown artifact opens in the document editor',
    editorShown,
    `editor showing the document: ${editorShown}`
  );
} finally {
  await instance.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
