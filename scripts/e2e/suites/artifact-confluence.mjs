#!/usr/bin/env node
/* global document, window -- page.evaluate callbacks run inside the app window */
/**
 * P5 done-check (plan 2026-09-23 §4 P5), on the shared-items step 3 surfaces:
 * publishing lives in the Share dialog's Publish tab, and a published
 * artifact wears a Confluence chip in its file bar that opens that tab.
 *
 *   node scripts/e2e/lib/build-e2e-app.mjs && pnpm run dev:server
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/suites/artifact-confluence.mjs
 *   node scripts/e2e/suites/artifact-confluence.mjs path/to/Chord.exe   # a packaged build
 *
 * The seed profile (CHORD_E2E_SEED_PROFILE, default `chord-p1-smoke`) must own
 * a synced work item with a repo, in a team that allows Confluence publishing.
 * Publishes to a REAL Confluence test space (credentials: confluence-rest.mjs)
 * through the real UI, and checks every outcome against Confluence's own API:
 *
 *   1. Integrations connects Confluence; the Publishing card reflects it
 *   2. publishing a document creates a page in the test space
 *   3. editing the artifact shows "Out of date"
 *   4. republishing updates the same page id
 *   5. an edit made in Confluence shows "Edited in Confluence"; Overwrite replaces it
 *   6. a web page publishes as an attachment + link; a prototype and an MDX
 *      component as PNG snapshots
 *   7. "Update automatically" follows a saved version without a click
 *
 * Every page it creates is deleted at the end. Exits non-zero on failure.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConfluencePublishUi } from '../lib/confluence-publish-ui.mjs';
import { createConfluenceRest, loadConfluenceTestEnv } from '../lib/confluence-rest.mjs';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { launchSeededApp } from '../lib/seeded-app.mjs';

const STAMP = Date.now();
const FIXTURE_DIR = '.chord-p5-fixtures';
const SHOT_DIR = E2E_SHOTS_DIR;
const DOC = `P5 plan ${STAMP}`;
const WEB = `P5 page ${STAMP}`;
const PROTO = `P5 prototype ${STAMP}`;
const RICH = `P5 rich ${STAMP}`;
const FIXTURES = {
  [DOC]: [
    'p5-plan.md',
    '# P5 plan\n\nShip the Confluence publish.\n\n- [ ] Review the page\n\n```ts\nconst ok = 1 < 2;\n```\n',
  ],
  [WEB]: [
    'p5-page.html',
    '<!doctype html><html><body><h1>P5 web page</h1><p>Served as an attachment.</p></body></html>\n',
  ],
  [PROTO]: [
    'P5Counter.tsx',
    "import { useState } from 'react';\nexport default function Counter() {\n  const [n, setN] = useState(0);\n  return <button style={{ padding: 24, fontSize: 24 }} onClick={() => setN(n + 1)}>Clicked {n} times</button>;\n}\n",
  ],
  [RICH]: [
    'p5-rich.mdx',
    "export const total = 42\n\n# Rich report\n\nSome text before.\n\n<div style={{ padding: 24, border: '2px solid', fontSize: 28 }}>Total: {total}</div>\n\nClosing text.\n",
  ],
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const env = loadConfluenceTestEnv();
const rest = createConfluenceRest(env);
const { page, rpc, readStdout, readStderr, close } = await launchSeededApp({
  exe: process.argv[2],
  source: process.argv[2] ? 'packaged' : 'built',
  profilePrefix: 'chord-p5-e2e',
  env: { LOG_LEVEL: 'info' },
});

async function call(channel, ...args) {
  const res = await rpc(channel, ...args);
  if (!res?.success) throw new Error(`${channel} failed: ${JSON.stringify(res)}`);
  return res.data;
}

const {
  bodyText,
  clickButton,
  waitFor,
  readState,
  readChip,
  findOnePage,
  openArtifact,
  openPublish,
  closePublish,
  publishAndFind,
} = createConfluencePublishUi(page, rest);

const created = [];
let fixtureRoot = null;
try {
  // Share needs an item this account owns and has synced (sharing-availability.ts).
  const session = await rpc('account.getSession');
  const { items } = await call('workItems.getAll');
  const workItem = items.find(
    (w) =>
      w.repoPath &&
      existsSync(w.repoPath) &&
      w.cloudId !== null &&
      w.ownerAccountId === session.user.userId
  );
  if (!workItem) throw new Error('Seed profile owns no synced work item with an existing repoPath');
  fixtureRoot = join(workItem.repoPath, FIXTURE_DIR);
  mkdirSync(fixtureRoot, { recursive: true });
  const files = {};
  for (const [name, [fileName, body]] of Object.entries(FIXTURES)) {
    files[name] = join(fixtureRoot, `${STAMP}-${fileName}`);
    writeFileSync(files[name], body);
    await call('artifacts.create', { workItemId: workItem.id, filePath: files[name], name });
  }
  // Only artifacts in the cloud can be picked under What.
  await waitFor(
    async () => {
      const { artifacts } = await call('artifacts.listByWorkItem', workItem.id);
      return Object.keys(FIXTURES).every((name) =>
        artifacts.some((a) => a.name === name && a.syncedAt !== null)
      );
    },
    90_000,
    'the fixtures synced'
  );

  // ── 1: connect, and the Publishing card ────────────────────────────────
  const saved = await rpc('confluence.saveCredentials', {
    siteUrl: env.siteUrl,
    email: env.email,
    token: env.token,
  });
  check(
    'Chord accepts the Confluence credentials',
    saved?.success === true,
    JSON.stringify(saved?.error ?? '')
  );
  await rpc('appSettings.update', 'artifacts', {
    ...(await rpc('appSettings.get', 'artifacts')),
    enabled: true,
    preferredFormat: 'best-fit',
    confluenceDefaultSpaceKey: env.spaceKey,
    confluenceUpdateMode: 'ask',
  });
  await page.reload();
  await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 60_000 });
  const host = new URL(env.siteUrl).host;

  await page.click('[title="Settings"]');
  await waitFor(async () => (await bodyText()).includes('Integrations'), 30_000, 'settings');
  await clickButton('Integrations');
  check(
    'Integrations shows Confluence connected',
    await waitFor(
      async () => (await bodyText()).includes(`Connected · ${host}`),
      30_000,
      'integrations row'
    )
  );
  await clickButton('Artifacts');
  const cardReady = await waitFor(
    async () => {
      const text = await bodyText();
      return text.includes('Default space') && text.includes('When an artifact changes');
    },
    30_000,
    'publishing card'
  );
  // The Publishing card alone: the page around it also holds "Ask before
  // deleting a shared artifact", which is sharing's, not Confluence's.
  const cardText = await page
    .locator('div')
    .filter({ hasText: 'Default space' })
    .filter({ hasText: 'When an artifact changes' })
    .last()
    .innerText();
  const spaceShown = await page.evaluate(
    () => document.querySelector('[aria-label="Default Confluence space"]')?.textContent ?? ''
  );
  check(
    'the Publishing card reflects the connection, the default space and the update choice',
    cardReady &&
      cardText.includes(`Connected · ${host}`) &&
      cardText.includes('Ask before updating the Confluence page') &&
      spaceShown.trim().length > 0 &&
      !cardText.includes('Ask before deleting'),
    `space="${spaceShown.trim()}"; card=${JSON.stringify(cardText)}`
  );
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, 'p5-publishing-card.png') });

  // Open the work item's rail, where its artifacts are listed.
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

  // ── 2–5: a document ────────────────────────────────────────────────────
  await openArtifact(DOC);
  const first = await publishAndFind(DOC);
  if (first) created.push(first.id);
  check(
    'publishing a document creates a page in the test space',
    !!first &&
      first.storage.includes('Ship the Confluence publish') &&
      first.storage.includes('<ac:task-list>') &&
      first.storage.includes('ac:name="code"'),
    first ? `page ${first.id} v${first.version}` : 'no single page with that title'
  );
  check(
    'the file bar wears the Confluence chip: Published vN',
    (await readChip())?.startsWith('Published to Confluence (v') ?? false,
    String(await readChip())
  );
  await page.screenshot({ path: join(SHOT_DIR, 'p5-doc-published.png') });

  await page.locator('.ProseMirror').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Edited in Chord.');
  check(
    'editing the artifact turns the chip to out of date',
    await waitFor(
      async () => (await readChip())?.startsWith('Confluence is out of date') ?? false,
      20_000,
      'out of date'
    ),
    String(await readChip())
  );

  await openPublish();
  await waitFor(async () => (await readState()) === 'out_of_date', 20_000, 'out of date tab');
  await clickButton('Update Confluence');
  await waitFor(async () => (await readState()) === 'published', 60_000, 'republished');
  await closePublish();
  const second = await findOnePage(DOC);
  check(
    'republishing updates the same page id',
    !!first &&
      !!second &&
      second.id === first.id &&
      second.version > first.version &&
      second.storage.includes('Edited in Chord'),
    second ? `page ${second.id} v${second.version}` : 'page missing'
  );

  await rest.appendParagraphRemotely(second.id, 'Edited in Confluence by the e2e run.');
  check(
    'an edit made in Confluence turns the chip to Edited in Confluence',
    await waitFor(
      async () => (await readChip())?.startsWith('Edited in Confluence') ?? false,
      45_000,
      'edited in confluence'
    ),
    String(await readChip())
  );
  await page.screenshot({ path: join(SHOT_DIR, 'p5-edited-in-confluence.png') });
  await openPublish();
  await waitFor(async () => (await readState()) === 'edited', 20_000, 'edited tab');
  await clickButton('Overwrite their edits');
  await waitFor(async () => (await readState()) === 'published', 60_000, 'overwritten');
  await closePublish();
  const third = await findOnePage(DOC);
  check(
    'Overwrite replaces the Confluence edit with Chord’s version, on the same page',
    !!third &&
      third.id === second.id &&
      !third.storage.includes('Edited in Confluence by the e2e run'),
    third ? `v${third.version}` : 'page missing'
  );

  // ── 6: web page, prototype, rich document ──────────────────────────────
  await openArtifact(WEB);
  const web = await publishAndFind(WEB);
  if (web) created.push(web.id);
  const webFiles = web ? await rest.listAttachments(web.id) : [];
  check(
    'a web page publishes as an HTML attachment with a link to it',
    !!web &&
      webFiles.some(
        (a) => a.title.endsWith('p5-page.html') && a.mediaType.startsWith('text/html')
      ) &&
      web.storage.includes('<ri:attachment'),
    JSON.stringify(webFiles)
  );

  await openArtifact(PROTO);
  const proto = await publishAndFind(PROTO, 180_000);
  if (proto) created.push(proto.id);
  const protoFiles = proto ? await rest.listAttachments(proto.id) : [];
  check(
    'a prototype publishes as a PNG snapshot shown on the page',
    !!proto &&
      protoFiles.some(
        (a) => a.title === 'prototype.png' && a.mediaType === 'image/png' && a.fileSize > 1000
      ) &&
      proto.storage.includes('ri:filename="prototype.png"'),
    JSON.stringify(protoFiles)
  );

  await openArtifact(RICH);
  const rich = await publishAndFind(RICH, 180_000);
  if (rich) created.push(rich.id);
  const richFiles = rich ? await rest.listAttachments(rich.id) : [];
  check(
    'a rich document publishes its text and a PNG per component',
    !!rich &&
      rich.storage.includes('Rich report') &&
      rich.storage.includes('Closing text') &&
      richFiles.some(
        (a) => a.title === 'component-1.png' && a.mediaType === 'image/png' && a.fileSize > 1000
      ),
    JSON.stringify(richFiles)
  );

  // ── 7: update automatically ────────────────────────────────────────────
  await rpc('appSettings.update', 'artifacts', {
    ...(await rpc('appSettings.get', 'artifacts')),
    enabled: true,
    preferredFormat: 'best-fit',
    confluenceDefaultSpaceKey: env.spaceKey,
    confluenceUpdateMode: 'auto',
  });
  const webArtifact = (await call('artifacts.listByWorkItem', workItem.id)).artifacts.find(
    (a) => a.name === WEB
  );
  const html =
    '<!doctype html><html><body><h1>P5 web page</h1><p>Changed, and saved as a version.</p></body></html>\n';
  writeFileSync(files[WEB], html);
  const { versions } = await call('artifacts.listVersions', { artifactId: webArtifact.id });
  const offset = readStdout().length;
  const errOffset = readStderr().length;
  await call('artifacts.saveVersion', {
    artifactId: webArtifact.id,
    content: html,
    trigger: 'manual',
    baseVersion: versions[0]?.versionNumber ?? 0,
  });
  // The page moves before the publish records it; wait for the whole publish
  // (main logs once it has recorded), then compare against Confluence.
  const recorded = await waitFor(
    async () => readStdout().slice(offset).includes('confluence: page updated automatically'),
    60_000,
    'automatic update'
  );
  const followed = web ? await findOnePage(WEB) : null;
  const status = await call('confluence.getStatus', { artifactId: webArtifact.id });
  check(
    'with "Update automatically", a saved version updates the page without a click',
    recorded &&
      !!followed &&
      followed.version > web.version &&
      status.status.state === 'published' &&
      status.status.confluenceVersion === followed.version,
    `page v${followed?.version}, status ${JSON.stringify(status.status)}; ` +
      `${readStdout().slice(offset)}\n${readStderr().slice(errOffset)}`
        .split('\n')
        .filter((line) => line.includes('confluence'))
        .join(' | ')
  );
} finally {
  await close();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  for (const title of [DOC, WEB, PROTO, RICH]) {
    for (const leftover of await rest.findPagesByTitle(title)) {
      if (!created.includes(leftover.id)) created.push(leftover.id);
    }
  }
  for (const id of created) await rest.deletePage(id);
  console.log(`cleaned up ${created.length} test page(s)`);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All Confluence checks passed');
