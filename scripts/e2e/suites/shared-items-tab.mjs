/* global localStorage -- page.evaluate callbacks run inside the app window */
/**
 * Shared-items step 1 done-check (the shared-items step 1 plan):
 * the path tab's file bar, Preview for each format, Diff and Edit in the tab,
 * and an Edit saved with Ctrl+S. Part A opens files in a repo it creates (a
 * changed page, a page never opened, an image, plain source and a README
 * published as an artifact); part B edits a second throw-away repo. Both are
 * removed at the end.
 * Part C (S6, shared-items-comments.mjs) comments on a page and a document
 * artifact in that repo: pins, click-to-comment, the card's filter and
 * numbers, "Element changed", and document badges.
 *
 *   pnpm exec electron-vite build --outDir .e2e-app/out   (or node scripts/e2e/lib/build-e2e-app.mjs)
 *   pnpm run dev:server                                    (the local sync server on :1234)
 *   node scripts/e2e/suites/shared-items-tab.mjs
 *
 * Part D (S7, shared-items-versions.mjs) restores a page and a document from
 * the Versions card. Part E (S8, shared-items-rail.mjs) checks the rail's
 * `💬 N  vN` and opening a card from it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { createScratchRepo, deleteWorkItemFromCloud, removeScratchRepo } from '../lib/run-scratch.mjs';
import { launchSeededApp, ROOT } from '../lib/seeded-app.mjs';
import { checkComments, COMMENT_FIXTURES } from '../lib/shared-items-comments.mjs';
import { checkRail } from '../lib/shared-items-rail.mjs';
import { checkVersions } from '../lib/shared-items-versions.mjs';

const OUT = E2E_SHOTS_DIR;
const plainPage = (heading) =>
  `<!doctype html>\n<html><body><h1 id="t">${heading}</h1></body></html>\n`;
/** Part A's repo: each file is one kind the file bar treats differently. */
const READ_FIXTURES = {
  'page.html': plainPage('Read probe'),
  'index-ja.html': plainPage('読み取り'),
  'preview.png': Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  ),
  LICENSE: 'Read probe licence: no rights reserved.\n',
  'README.md': '# Read probe\n\nPublished as an artifact.\n',
};
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail = '') => {
  lastStep = name;
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const s = await launchSeededApp({
  source: 'built',
  appDir: process.env.CHORD_E2E_APP_DIR ?? join(ROOT, '.e2e-app'),
  profilePrefix: 'chord-s3-probe',
});
const errors = [];
let lastStep = 'start';
const NL = String.fromCharCode(10);
s.page.on('pageerror', (e) => {
  errors.push(String(e).slice(0, 300));
  console.log('PAGEERROR at', lastStep, NL, (e.stack ?? '').split(NL).slice(0, 12).join(NL));
});
const shot = (n) => s.page.screenshot({ path: join(OUT, `shared-step1-${n}.png`) });
const bar = () => s.page.locator('[data-testid="file-bar"]').first();
const openFromFiles = async (title) => {
  // Every rail panel stays mounted; a changed file is a row in the hidden
  // Changes panel too, so only the visible (Files) row is the one to click.
  const row = s.page.locator(`button[title="${title}"]:visible`).first();
  if (!(await row.isVisible().catch(() => false))) {
    await s.page.getByText('Files', { exact: true }).first().click();
    await s.page.waitForTimeout(800);
  }
  await row.click();
  await s.page.waitForTimeout(2500);
};
/** A work item on `repoPath`, once provisioned; part A's setup, so a failure stops the run. */
async function createReadyItem(name, repoPath) {
  const created = await s.rpc('workItems.create', { name, repoPath });
  if (!created.success) throw new Error(`${name}: ${JSON.stringify(created.error)}`);
  for (let i = 0; i < 40; i++) {
    const all = await s.rpc('workItems.getAll');
    const item = all.data.items.find((w) => w.id === created.data.item.id);
    if (item?.provisionStatus === 'ready') return item;
    await s.page.waitForTimeout(500);
  }
  throw new Error(`${name} did not provision`);
}

let readRepo;
let readId;
let repo;
let id;
let removedFromApp = false;
try {
  await s.page.waitForTimeout(5000);
  // A. Opening files of each kind, in a repo of the run's own. The page has
  // uncommitted changes (Diff · Preview · Edit); README.md is an artifact.
  readRepo = createScratchRepo('s3-read', READ_FIXTURES);
  const readItem = await createReadyItem('S3 read probe', readRepo);
  readId = readItem.id;
  writeFileSync(join(readItem.repoPath, 'page.html'), plainPage('Read probe, edited'));
  const published = await s.rpc('artifacts.create', {
    workItemId: readId,
    filePath: join(readItem.repoPath, 'README.md'),
    name: 'README.md',
  });
  if (!published.success) throw new Error(`README.md: ${JSON.stringify(published.error)}`);
  await s.page.getByText('S3 read probe', { exact: true }).first().click();
  await s.page.waitForTimeout(3000);

  await openFromFiles('page.html');
  const barText = await bar().innerText();
  check(
    'a non-artifact .html opens with the file bar',
    barText.includes('page.html'),
    barText.replace(/\s+/g, ' ')
  );
  check(
    'its modes are Diff · Preview · Edit (the file has changes)',
    /Diff[\s\S]*Preview[\s\S]*Edit/.test(barText)
  );
  const pickMode = async (label) => {
    const button = bar().getByText(label, { exact: true });
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
    await s.page.waitForTimeout(2000);
  };
  await pickMode('Preview');
  const frame = s.page.locator('[data-testid="repo-page-preview"] iframe');
  await frame
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  check('Preview renders the page in a frame', (await frame.count()) === 1);
  await shot('html-preview');
  await pickMode('Diff');
  check(
    'Diff shows the diff inside the same tab',
    await s.page.getByText('Undo All').first().isVisible()
  );
  await shot('html-diff');
  await pickMode('Edit');
  check(
    'Edit shows the editable source',
    (await s.page.locator('[data-testid="file-editor"]').count()) === 1
  );

  const persisted = await s.page.evaluate(() => localStorage.getItem('chord:center-tabs') ?? '');
  check(
    'the mode is remembered on the tab',
    /"filePath":"page.html"[^}]*"mode":"edit"/.test(persisted)
  );

  await openFromFiles('index-ja.html');
  const fresh = bar().getByText('Preview', { exact: true });
  check(
    'a page never opened before defaults to Preview',
    (await fresh.getAttribute('aria-pressed')) === 'true'
  );

  await openFromFiles('preview.png');
  const pngBar = await bar().innerText();
  check(
    'an image previews only (no mode switch)',
    !/Diff|Edit/.test(pngBar),
    pngBar.replace(/\s+/g, ' ')
  );
  await shot('png-preview');

  await openFromFiles('LICENSE');
  check(
    'plain source defaults to Edit',
    (await s.page.locator('[data-testid="file-editor"]').count()) === 1
  );

  await openFromFiles('README.md');
  check(
    'an artifact gets 💬 and 🕘 on its bar',
    (await bar().locator('button[title="Comments"]').count()) === 1 &&
      (await bar().locator('button[title="Versions"]').count()) === 1
  );
  await shot('artifact-bar');

  // B. Edit + ⌘S on a throw-away repo.
  repo = createScratchRepo('s3-save', {
    'app.ts': 'export const answer = 41;\n',
    'plain.html': plainPage('Plain page'),
    ...COMMENT_FIXTURES,
  });
  const created = await s.rpc('workItems.create', { name: 'S3 save probe', repoPath: repo });
  check(
    'the throw-away work item is created',
    created.success,
    JSON.stringify(created.error ?? '')
  );
  id = created.data.item.id;
  let row;
  for (let i = 0; i < 40; i++) {
    const all = await s.rpc('workItems.getAll');
    row = all.data.items.find((w) => w.id === id);
    if (row?.provisionStatus === 'ready') break;
    await s.page.waitForTimeout(500);
  }
  check('it provisions', row?.provisionStatus === 'ready', row?.provisionStatus);
  await s.page.getByText('S3 save probe', { exact: true }).first().click();
  await s.page.waitForTimeout(2500);
  await openFromFiles('app.ts');
  await shot('save-before-editor');
  await s.page
    .locator('[data-testid="file-editor"] .monaco-editor')
    .first()
    .click({ timeout: 10000 });
  await s.page.keyboard.press('Control+End');
  await s.page.keyboard.type('export const next = 42;\n');
  await s.page.waitForTimeout(300);
  check('an edit shows as unsaved', await s.page.getByText('Unsaved changes').first().isVisible());
  await s.page.keyboard.press('Control+s');
  await s.page.waitForTimeout(1500);
  const onDisk = readFileSync(join(row.repoPath, 'app.ts'), 'utf-8');
  check(
    '⌘S writes the file in the worktree',
    onDisk.includes('export const next = 42;'),
    JSON.stringify(onDisk)
  );
  const tabs = await s.page.evaluate(() => localStorage.getItem('chord:center-tabs'));
  check(
    'the edited preview tab was promoted',
    /"filePath":"app.ts"[^}]*"isPreview":false/.test(tabs ?? '')
  );
  await shot('saved');

  // A repo page's Preview follows its file on disk (S9): no artifact, no agent turn.
  await openFromFiles('plain.html');
  const plainHeading = s.page
    .frameLocator('[data-testid="repo-page-preview"] iframe')
    .first()
    .locator('#t');
  const readHeading = (timeout) =>
    plainHeading.textContent({ timeout }).then(
      (text) => text?.trim() ?? null,
      () => null
    );
  const headingBefore = await readHeading(20_000);
  writeFileSync(join(row.repoPath, 'plain.html'), plainPage('Changed on disk'));
  let headingAfter = headingBefore;
  for (let i = 0; i < 40 && headingAfter !== 'Changed on disk'; i++) {
    await s.page.waitForTimeout(500);
    headingAfter = await readHeading(2_000);
  }
  check(
    'a repo page’s Preview reloads when its file changes on disk',
    headingBefore === 'Plain page' && headingAfter === 'Changed on disk',
    `before=${headingBefore} after=${headingAfter}`
  );

  // C. Comments card, pins and badges (S6), on the same throw-away work item.
  await checkComments({ s, check, shot, bar, openFromFiles, workItemId: id, root: row.repoPath });

  // D. The Versions card and Restore (S7), on the same page and document.
  await checkVersions({ s, check, shot, bar, openFromFiles, workItemId: id, root: row.repoPath });

  // E. The rail's counts and opening a card from them (S8).
  await checkRail({ s, check, shot, bar, openFromFiles, workItemId: id });
  const removed = await s.rpc('workItems.remove', id);
  removedFromApp = removed.success;
  check(
    'the throw-away work item is removed',
    removed.success,
    JSON.stringify(removed.error ?? '')
  );
  check('no page errors', errors.length === 0, JSON.stringify(errors));
} finally {
  // A run that stopped part-way still removes its items: their lanes would
  // otherwise stay under ~/chord/worktrees, and their rows in the cloud.
  if (readId) {
    await s.rpc('workItems.remove', readId);
    await deleteWorkItemFromCloud(s.rpc, readId).then(
      () => check('the read probe work item is removed from the cloud', true),
      (error) => check('the read probe work item is removed from the cloud', false, error.message)
    );
  }
  if (id) {
    if (!removedFromApp) await s.rpc('workItems.remove', id);
    await deleteWorkItemFromCloud(s.rpc, id).then(
      () => check('the throw-away work item is removed from the cloud', true),
      (error) => check('the throw-away work item is removed from the cloud', false, error.message)
    );
  }
  await s.close();
  if (readRepo) removeScratchRepo(readRepo);
  if (repo) removeScratchRepo(repo);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}
