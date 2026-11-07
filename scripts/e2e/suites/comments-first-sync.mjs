/**
 * devstation-85y done-check: a comment written on an artifact before its first
 * sync (the comments card writes to the device while the artifact has no cloud
 * id) is still there after the sync, when the bar and the rail read the cloud.
 * Runs on a throw-away work item and repo it creates and removes.
 *
 *   node scripts/e2e/lib/build-e2e-app.mjs
 *   pnpm run dev:server                      (the local sync server on :1234)
 *   node scripts/e2e/suites/comments-first-sync.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { createScratchRepo, deleteWorkItemFromCloud, removeScratchRepo } from '../lib/run-scratch.mjs';
import { launchSeededApp, ROOT } from '../lib/seeded-app.mjs';

const OUT = E2E_SHOTS_DIR;
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const settles = (promise) => promise.then(() => true).catch(() => false);

const s = await launchSeededApp({
  source: 'built',
  appDir: process.env.CHORD_E2E_APP_DIR ?? join(ROOT, '.e2e-app'),
  profilePrefix: 'chord-s3-probe',
});
const errors = [];
s.page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
const repo = createScratchRepo('first-sync', {
  'probe.html': '<!doctype html><html><body><h1>p</h1></body></html>\n',
});
let id;
try {
  await s.page.waitForTimeout(5000);
  const created = await s.rpc('workItems.create', { name: 'First sync probe', repoPath: repo });
  id = created.data.item.id;
  let row;
  for (let i = 0; i < 40 && row?.provisionStatus !== 'ready'; i++) {
    await s.page.waitForTimeout(500);
    row = (await s.rpc('workItems.getAll')).data.items.find((w) => w.id === id);
  }

  // Published and commented in one breath: the sync queue's first drain is
  // 500 ms away, so the comment lands on the device, as the card's would.
  const published = await s.rpc('artifacts.create', {
    workItemId: id,
    filePath: join(row.repoPath, 'probe.html'),
    name: 'probe.html',
  });
  const artifactId = published.data.artifact.id;
  const before = (await s.rpc('artifacts.get', artifactId)).data.artifact;
  const added = await s.rpc('artifacts.addComment', {
    artifactId,
    body: 'written before the first sync',
  });
  check(
    'the comment is written on the device while the artifact has no cloud id',
    before.cloudId === null && added.success,
    `cloudId=${before.cloudId} added=${added.success}`
  );

  let cloudId = null;
  for (let i = 0; i < 120 && !cloudId; i++) {
    await s.page.waitForTimeout(500);
    cloudId = (await s.rpc('artifacts.get', artifactId)).data.artifact.cloudId;
  }
  const deviceList = await s.rpc('artifacts.listComments', { artifactId });
  check(
    'after the sync the device keeps none of its comments',
    cloudId !== null && deviceList.success === false,
    `cloudId=${cloudId} device=${JSON.stringify(deviceList.error ?? deviceList.data)}`
  );

  await s.page.getByText('First sync probe', { exact: true }).first().click();
  await s.page.waitForTimeout(2500);
  const fileRow = s.page.locator('button[title="probe.html"]:visible').first();
  if (!(await fileRow.isVisible().catch(() => false))) {
    await s.page.getByText('Files', { exact: true }).first().click();
    await s.page.waitForTimeout(800);
  }
  await fileRow.click();
  const bar = s.page.locator('[data-testid="file-bar"]').first();
  const commentsButton = bar.locator('button[title="Comments"]');
  await commentsButton.waitFor({ timeout: 30_000 });
  let barCount = 0;
  for (let i = 0; i < 20 && barCount !== 1; i++) {
    await s.page.waitForTimeout(500);
    barCount = Number((await commentsButton.innerText()).replace(/\D/g, '') || 0);
  }
  check('the bar counts the comment', barCount === 1, `bar=${barCount}`);

  await commentsButton.click();
  const card = s.page.locator('[data-testid="comments-card"]');
  const listed = await settles(
    card.getByText('written before the first sync').first().waitFor({ timeout: 10_000 })
  );
  check('the comments card lists it', listed);
  await s.page.screenshot({ path: join(OUT, 'comments-first-sync-card.png') });

  await s.page
    .getByRole('tab', { name: /^Work item/ })
    .first()
    .click();
  const railButton = s.page
    .locator(`[data-testid="artifact-rail-counts"][data-artifact-id="${artifactId}"]`)
    .locator('button[title="Open comments"]');
  const railShown = await settles(railButton.waitFor({ timeout: 30_000 }));
  const railCount = railShown ? Number((await railButton.innerText()).replace(/\D/g, '')) : 0;
  check('the rail counts it', railCount === 1, `rail=${railCount}`);
  await s.page.screenshot({ path: join(OUT, 'comments-first-sync-rail.png') });

  check('no page errors', errors.length === 0, JSON.stringify(errors));
} finally {
  if (id) {
    await s.rpc('workItems.remove', id);
    await deleteWorkItemFromCloud(s.rpc, id).then(
      () => check('the probe work item is removed from the cloud', true),
      (error) => check('the probe work item is removed from the cloud', false, error.message)
    );
  }
  await s.close();
  removeScratchRepo(repo);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}
