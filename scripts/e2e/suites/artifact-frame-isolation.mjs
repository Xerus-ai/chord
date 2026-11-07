#!/usr/bin/env node
/* global window, document, location, navigator -- page.evaluate callbacks run inside the app window */
/**
 * P1a done-check, run against a PACKAGED build (plan 2026-09-23 §4 P1a, §7).
 *
 *   node scripts/e2e/suites/artifact-frame-isolation.mjs [path/to/Chord.exe]
 *
 * Launches the packaged app under a throw-away profile seeded from an existing
 * one, creates a web page, an MDX component and a .tsx prototype as artifacts
 * of a real work item, opens each THROUGH THE UI (work item → rail → artifact
 * row, so the real ArtifactWorkspace, PageFrame and MdxNodeView are what
 * mount the frame), and asserts inside the sandboxed frame:
 *
 *   1. the .html artifact's inline script ran
 *   2. window.parent.document throws and no bridge global exists
 *   3. fetch('https://example.com') is blocked
 *   4. the frame cannot navigate itself to a foreign origin
 *   5. the MDX chart rendered (recharts SVG present) inside the document
 *   6. the prototype rendered and its button updates state
 *   7. a broken prototype shows the build error, not a blank frame
 *   8. the renderer CSP frame-src admits only chord-artifact:
 *   9. the renderer is still a secure context (clipboard, crypto.randomUUID)
 *
 * Exits non-zero on the first failed assertion. Prints one line per check.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchSeededApp } from '../lib/seeded-app.mjs';

const FIXTURE_DIR_NAME = '.chord-p1a-fixtures';

const fixtures = mkdtempSync(join(tmpdir(), 'chord-p1a-fixtures-'));
const FIXTURE_FILES = {
  'page.html': `<!doctype html><html><head><title>probe</title></head><body>
<h1 id="h">web page</h1>
<script>document.body.setAttribute('data-inline-ran', 'yes');</script>
</body></html>`,
  'chart.mdx': `import { BarChart, Bar, XAxis, YAxis } from 'recharts'
import { Callout } from 'chord-components'

<Callout type="success" title="Chart">rendered in a frame</Callout>

export const data = [{ k: 'a', v: 3 }, { k: 'b', v: 5 }]

<BarChart width={320} height={160} data={data}>
  <XAxis dataKey="k" />
  <YAxis />
  <Bar dataKey="v" fill="var(--status-ok)" />
</BarChart>
`,
  'counter.tsx': `import { useState } from 'react';
export default function Counter() {
  const [n, setN] = useState(0);
  return <button id="inc" onClick={() => setN(n + 1)}>Clicked {n} times</button>;
}
`,
  'broken.tsx': `export default function Broken() { return <div>{unclosed\n`,
};
for (const [name, body] of Object.entries(FIXTURE_FILES)) writeFileSync(join(fixtures, name), body);

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const { page, rpc, close } = await launchSeededApp({
  exe: process.argv[2],
  profilePrefix: 'chord-p1a-e2e',
});

let repoFixtures = null;
try {
  // A work item whose repo is a real directory; the fixtures are placed
  // under it so the bundler's repository containment passes.
  const workItems = await rpc('workItems.getAll');
  if (!workItems?.success) throw new Error(`workItems.getAll failed: ${JSON.stringify(workItems)}`);
  const workItem = workItems.data.items.find((w) => w.repoPath && existsSync(w.repoPath));
  if (!workItem) throw new Error('Seed profile has no work item with an existing repoPath');
  repoFixtures = join(workItem.repoPath, FIXTURE_DIR_NAME);
  mkdirSync(repoFixtures, { recursive: true });
  const files = {};
  for (const name of Object.keys(FIXTURE_FILES)) {
    files[name] = join(repoFixtures, name);
    cpSync(join(fixtures, name), files[name]);
  }

  async function createArtifact(name) {
    const res = await rpc('artifacts.create', {
      workItemId: workItem.id,
      filePath: files[name],
      name,
    });
    if (!res?.success) throw new Error(`artifacts.create failed: ${JSON.stringify(res)}`);
    return res.data.artifact;
  }
  for (const name of Object.keys(FIXTURE_FILES)) await createArtifact(name);

  // Renderer CSP as delivered on the packaged document.
  const csp = await page.evaluate(async () => {
    const res = await fetch(location.href);
    return res.headers.get('content-security-policy') ?? '';
  });
  check(
    'renderer CSP frame-src is chord-artifact: only',
    /frame-src chord-artifact:(;|$)/.test(csp),
    csp.match(/frame-src[^;]*/)?.[0] ?? 'no frame-src'
  );

  // The privileged-scheme registration must leave app:// a secure context.
  const secure = await page.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    clipboard: typeof navigator.clipboard,
    randomUUID: typeof crypto.randomUUID,
  }));
  check(
    'renderer stays a secure context (clipboard + crypto.randomUUID present)',
    secure.isSecureContext && secure.clipboard === 'object' && secure.randomUUID === 'function',
    JSON.stringify(secure)
  );

  // Navigate the real UI: sidebar work item → "Work item" rail tab.
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('button, a, div, span')].find(
      (el) => el.children.length < 4 && el.textContent.trim() === name
    );
    if (!row) throw new Error(`Sidebar row not found: ${name}`);
    row.click();
  }, workItem.name);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button, [role=tab]')].find(
      (el) => el.textContent.trim() === 'Work item'
    );
    // Clicking the rail panel already shown closes the rail (rail-store.ts activate).
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.startsWith('page.html')),
    null,
    { timeout: 30_000 }
  );

  /** Clicks the artifact row in the rail and returns the sandboxed frame the UI mounted. */
  async function openArtifactThroughUi(name) {
    await page.evaluate((artifactName) => {
      const row = [...document.querySelectorAll('button')].find((b) =>
        b.textContent.trim().startsWith(artifactName)
      );
      if (!row) throw new Error(`Artifact row not found: ${artifactName}`);
      row.click();
    }, name);
    const handle = await page.waitForSelector('iframe[src^="chord-artifact://"]', {
      timeout: 60_000,
    });
    const sandbox = await handle.getAttribute('sandbox');
    const srcdoc = await handle.getAttribute('srcdoc');
    check(
      `${name}: UI mounts sandbox="allow-scripts" and no srcdoc`,
      sandbox === 'allow-scripts' && srcdoc === null,
      `sandbox=${sandbox}`
    );
    const frame = await handle.contentFrame();
    await frame.waitForLoadState('domcontentloaded');
    return { frame };
  }

  // 1 + 2 + 3 + 4: the web page.
  {
    const { frame } = await openArtifactThroughUi('page.html');
    await frame.waitForSelector('#h');
    const inlineRan = await frame.evaluate(() => document.body.getAttribute('data-inline-ran'));
    check('.html inline script runs in the frame', inlineRan === 'yes');

    const probe = await frame.evaluate(async () => {
      const out = {};
      try {
        void window.parent.document;
        out.parentDocument = 'accessible';
      } catch (e) {
        out.parentDocument = `blocked: ${e.name}`;
      }
      out.bridge = typeof window.electronAPI;
      out.origin = window.origin;
      try {
        await fetch('https://example.com', { mode: 'no-cors' });
        out.fetch = 'allowed';
      } catch (e) {
        out.fetch = `blocked: ${e.name}`;
      }
      return out;
    });
    check(
      'window.parent.document throws',
      probe.parentDocument.startsWith('blocked'),
      probe.parentDocument
    );
    check(
      'no bridge global in the frame',
      probe.bridge === 'undefined',
      `typeof electronAPI = ${probe.bridge}`
    );
    check('frame origin is opaque', probe.origin === 'null', probe.origin);
    check(
      "fetch('https://example.com') is blocked",
      probe.fetch.startsWith('blocked'),
      probe.fetch
    );

    // The frame tries to leave for a foreign origin. The renderer CSP
    // (frame-src) refuses it, main reports the blocked frame, and the host
    // remounts the page: afterwards no frame may sit on a foreign origin and
    // the page's own document must be back, inline script re-run.
    await frame.evaluate(() => {
      location.href = 'https://example.com/';
    });
    await page
      .waitForSelector('iframe[src^="chord-artifact://"][src*="v=1"]', { timeout: 15_000 })
      .catch(() => null);
    await page.waitForTimeout(1500);
    const frameUrls = page.frames().map((f) => f.url());
    const foreign = frameUrls.filter((u) => /^https?:/.test(u));
    const remounted = await page.$('iframe[src^="chord-artifact://"]');
    const current = remounted ? await remounted.contentFrame() : null;
    const marker = current
      ? await current.evaluate(() => document.body?.getAttribute('data-inline-ran') ?? null)
      : null;
    const currentUrl = current ? current.url() : 'no content frame';
    check(
      'frame cannot navigate itself to a foreign origin',
      foreign.length === 0 && currentUrl.startsWith('chord-artifact://') && marker === 'yes',
      `frame url ${currentUrl}, marker ${marker}, foreign frames ${JSON.stringify(foreign)}`
    );
  }

  // 5: the MDX chart, embedded in the document editor.
  {
    const { frame } = await openArtifactThroughUi('chart.mdx');
    const inEditor = await page.evaluate(
      () => !!document.querySelector('.ProseMirror iframe[src^="chord-artifact://"]')
    );
    check('MDX component frame is mounted inside the document', inEditor);
    await frame.waitForSelector('svg.recharts-surface', { timeout: 30_000 });
    const bars = await frame.evaluate(
      () => document.querySelectorAll('.recharts-bar-rectangle').length
    );
    check('MDX chart renders inside its frame', bars >= 2, `${bars} bars`);
    const callout = await frame.evaluate(
      () => document.querySelector('.chord-callout')?.textContent ?? ''
    );
    check('chord-components render in the frame', callout.includes('rendered in a frame'), callout);
  }

  // 6: the prototype.
  {
    const { frame } = await openArtifactThroughUi('counter.tsx');
    await frame.waitForSelector('#inc', { timeout: 30_000 });
    const before = await frame.textContent('#inc');
    await frame.click('#inc');
    await frame.click('#inc');
    const after = await frame.textContent('#inc');
    check(
      '.tsx prototype renders and its button updates state',
      before === 'Clicked 0 times' && after === 'Clicked 2 times',
      `${before} → ${after}`
    );
  }

  // 7: a prototype that does not compile shows the error, never a blank frame.
  {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('button')].find((b) =>
        b.textContent.trim().startsWith('broken.tsx')
      );
      if (!row) throw new Error('Artifact row not found: broken.tsx');
      row.click();
    });
    await page.waitForFunction(
      () => document.body.innerText.includes('The page could not be built'),
      null,
      { timeout: 30_000 }
    );
    const state = await page.evaluate(() => ({
      frames: document.querySelectorAll('iframe[src^="chord-artifact://"]').length,
      error: /Expected "}"|Unexpected end of file|error/i.test(document.body.innerText),
    }));
    check(
      'broken prototype shows the build error and mounts no frame',
      state.frames === 0 && state.error,
      JSON.stringify(state)
    );
  }
} finally {
  await close();
  if (repoFixtures) rmSync(repoFixtures, { recursive: true, force: true });
  rmSync(fixtures, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All frame-isolation checks passed');
