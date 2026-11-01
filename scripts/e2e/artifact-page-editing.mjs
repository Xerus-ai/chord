#!/usr/bin/env node
/* global document -- page.evaluate callbacks run inside the app window */
/**
 * P1b done-check, run against a PACKAGED build (plan 2026-09-23 §4 P1b).
 *
 *   node scripts/e2e/artifact-page-editing.mjs [path/to/Chord.exe]
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/artifact-page-editing.mjs
 *
 * Publishes a web page and a .tsx prototype as artifacts of a real work item
 * (artifacts.create — the "Add to artifacts" path), opens each through the UI
 * and asserts:
 *
 *   1. publishing stamps data-chord-id on the page's elements, and a second
 *      publish changes nothing
 *   2. Edit text (a double-click, since shared-items S6): editing the heading
 *      in the frame changes the source file at that element only
 *   3. the edit is saved as a version
 *   4. reopening the page shows the edited heading
 *   5. script-built text is not editable and double-clicking it says to ask
 *      the agent
 *   6. with the comments card open, picking the prototype's button opens the
 *      comment card with that element, and the click does not press the button
 *   7. a prototype does not edit text on a double-click, and the old Select /
 *      Edit text buttons are gone
 *   8. commenting on a picked page element anchors the comment to its id
 *
 * Exits non-zero if any check failed. Prints one line per check.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchSeededApp } from './seeded-app.mjs';

const FIXTURE_DIR_NAME = '.chord-p1b-fixtures';
const PAGE = 'edit-page.html';
const PROTOTYPE = 'pick-counter.tsx';

const FIXTURE_FILES = {
  [PAGE]: `<!doctype html>
<html>
<head><title>edit probe</title></head>
<body>
  <h1 id="h">
    Original heading
  </h1>
  <p id="keep">Untouched paragraph</p>
  <div id="gen"></div>
  <script>document.getElementById('gen').textContent = 'Built by script';</script>
</body>
</html>
`,
  [PROTOTYPE]: `import { useState } from 'react';
export default function Counter() {
  const [n, setN] = useState(0);
  return <button id="inc" onClick={() => setN(n + 1)}>Clicked {n} times</button>;
}
`,
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// CHORD_E2E_APP_DIR runs it against an e2e build (build-e2e-app.mjs) instead.
const { page, rpc, close } = await launchSeededApp({
  exe: process.argv[2],
  source: process.env.CHORD_E2E_APP_DIR ? 'built' : 'packaged',
  profilePrefix: 'chord-p1b-e2e',
});

let repoFixtures = null;
try {
  const workItems = await rpc('workItems.getAll');
  if (!workItems?.success) throw new Error(`workItems.getAll failed: ${JSON.stringify(workItems)}`);
  const workItem = workItems.data.items.find((w) => w.repoPath && existsSync(w.repoPath));
  if (!workItem) throw new Error('Seed profile has no work item with an existing repoPath');
  repoFixtures = join(workItem.repoPath, FIXTURE_DIR_NAME);
  mkdirSync(repoFixtures, { recursive: true });
  const files = {};
  for (const [name, body] of Object.entries(FIXTURE_FILES)) {
    files[name] = join(repoFixtures, name);
    writeFileSync(files[name], body);
  }

  async function publish(name) {
    const res = await rpc('artifacts.create', {
      workItemId: workItem.id,
      filePath: files[name],
      name,
    });
    if (!res?.success) throw new Error(`artifacts.create failed: ${JSON.stringify(res)}`);
    return res.data.artifact;
  }

  // 1: stamping on publish, idempotent on republish.
  const pageArtifact = await publish(PAGE);
  const stamped = readFileSync(files[PAGE], 'utf-8');
  const headingId = /<h1 data-chord-id="([a-z0-9]+)" id="h">/.exec(stamped)?.[1];
  const paragraphId = /<p data-chord-id="([a-z0-9]+)" id="keep">/.exec(stamped)?.[1];
  const unstampedElsewhere =
    stamped.replace(/ data-chord-id="[a-z0-9]+"/g, '') === FIXTURE_FILES[PAGE];
  // Every pickable element is stamped since d3822b4 (stable picker identity),
  // the script-filled <div> included; which of them edit is the source's
  // text, sent with the mode (editable-text-ids.ts).
  check(
    'publishing stamps the page elements and changes nothing else',
    !!headingId && !!paragraphId && unstampedElsewhere && !/<script data-chord-id/.test(stamped),
    `h1=${headingId} p=${paragraphId}`
  );
  await publish(PAGE);
  check(
    'republishing an unchanged page is no diff',
    readFileSync(files[PAGE], 'utf-8') === stamped
  );
  await publish(PROTOTYPE);

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
    (name) => [...document.querySelectorAll('button')].some((b) => b.textContent.startsWith(name)),
    PAGE,
    { timeout: 30_000 }
  );

  async function openArtifact(name) {
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
    const frame = await handle.contentFrame();
    await frame.waitForLoadState('domcontentloaded');
    return frame;
  }

  const toolbarButton = (label) =>
    page.evaluate(
      (text) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === text),
      label
    );
  // The file bar's 💬 opens and closes the comments card; while it is open a
  // click in the page picks the element under it.
  const toggleComments = () =>
    page.evaluate(() => {
      const button = document.querySelector('[data-testid="file-bar"] button[title="Comments"]');
      if (!button) throw new Error('Comments button not found on the file bar');
      button.click();
    });

  // 2 + 3 + 5: edit the heading in place.
  {
    const frame = await openArtifact(PAGE);
    await frame.waitForSelector('#h');
    await frame.dblclick('#gen');
    const genEditable = await frame.evaluate(() =>
      document.getElementById('gen').hasAttribute('contenteditable')
    );
    const hint = await frame.evaluate(() => {
      const el = document.getElementById('chord-runtime-edit-hint');
      return el && el.style.display === 'block' ? el.textContent : null;
    });
    check(
      'script-built text is not editable and double-clicking it says to ask the agent',
      !genEditable && !!hint?.includes('ask the agent'),
      `editable=${genEditable} hint=${hint}`
    );

    await frame.dblclick('#h');
    await frame.waitForSelector('#h[contenteditable="plaintext-only"]', { timeout: 10_000 });
    await frame.fill('#h', 'Edited heading');
    await frame.press('#h', 'Enter');
    const expected = stamped.replace('Original heading', 'Edited heading');
    const deadline = Date.now() + 15_000;
    let onDisk = readFileSync(files[PAGE], 'utf-8');
    while (onDisk !== expected && Date.now() < deadline) {
      await page.waitForTimeout(250);
      onDisk = readFileSync(files[PAGE], 'utf-8');
    }
    check(
      'editing the heading changes the source at that element only',
      onDisk === expected,
      onDisk === expected ? '' : JSON.stringify(onDisk.slice(0, 300))
    );

    const versions = await rpc('artifacts.listVersions', { artifactId: pageArtifact.id });
    const latest = versions?.data?.versions?.[0];
    check(
      'the edit is saved as a version',
      latest?.label === 'Edited in place' && latest?.content === expected,
      `v${latest?.versionNumber} ${latest?.label}`
    );
  }

  // 6 + 7: pick the prototype's button.
  {
    const frame = await openArtifact(PROTOTYPE);
    await frame.waitForSelector('#inc', { timeout: 30_000 });
    await toggleComments();
    await page.waitForTimeout(300);
    await frame.click('#inc');
    const card = await page.waitForSelector('[data-testid="ask-agent-card"]', { timeout: 10_000 });
    const cardText = await card.textContent();
    const buttonText = await frame.textContent('#inc');
    check(
      'picking the button opens the comment card with that element',
      cardText.includes('<button> Clicked 0 times'),
      cardText.slice(0, 120)
    );
    check('picking does not press the button', buttonText === 'Clicked 0 times', buttonText);
    await page.keyboard.press('Escape');
    await toggleComments();
    await page.waitForTimeout(300);

    await frame.dblclick('#inc');
    const incEditable = await frame.evaluate(() =>
      document.getElementById('inc').hasAttribute('contenteditable')
    );
    const oldButtons = (await toolbarButton('Edit text')) || (await toolbarButton('Select'));
    check(
      'a prototype does not edit text on a double-click, and Select / Edit text are gone',
      !incEditable && !oldButtons,
      `editable=${incEditable} oldButtons=${oldButtons}`
    );
  }

  // 4 + 8: reopen the page, then comment on the edited heading.
  {
    const frame = await openArtifact(PAGE);
    await frame.waitForSelector('#h');
    const heading = (await frame.textContent('#h')).trim();
    check('reopening the page shows the edited heading', heading === 'Edited heading', heading);

    await toggleComments();
    await page.waitForTimeout(300);
    await frame.click('#h');
    await page.waitForSelector('[data-testid="ask-agent-card"] textarea', { timeout: 10_000 });
    await page.fill('[data-testid="ask-agent-card"] textarea', 'P1b element comment');
    // A synced artifact's comments go to the cloud store, straight from the
    // renderer; an unsynced one's to the local table. Whichever it is, the
    // anchor key is read from what was actually written.
    const cloudPost = page
      .waitForRequest(
        (req) => req.method() === 'POST' && (req.postData() ?? '').includes('P1b element comment'),
        { timeout: 15_000 }
      )
      .catch(() => null);
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('[data-testid="ask-agent-card"] button')].find(
        (b) => b.textContent.trim() === 'Comment'
      );
      if (!button) throw new Error('Comment button not found');
      button.click();
    });
    await page.waitForFunction(
      () => document.body.innerText.includes('P1b element comment'),
      null,
      { timeout: 15_000 }
    );
    const local = await rpc('artifacts.listComments', { artifactId: pageArtifact.id });
    const stored = local?.data?.comments?.find((c) => c.body === 'P1b element comment');
    let anchorKey = stored?.anchorKey;
    let store = 'local';
    if (!stored) {
      const request = await cloudPost;
      anchorKey = request ? JSON.parse(request.postData()).anchor_key : undefined;
      store = 'cloud';
    }
    check(
      'a comment on a picked element anchors to its id',
      anchorKey === `chord-id:${headingId}`,
      `${store} store, anchor_key=${anchorKey}`
    );
  }
} finally {
  await close();
  if (repoFixtures) rmSync(repoFixtures, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All page-editing checks passed');
