/**
 * Live checks for Settings › Git › Compare base and Source control group
 * order, driven through the real UI (plan 2026-09-26, Phase 2 "Settings › Git"):
 *   - Compare base = Repository default: the lane's Changes panel compares its
 *     commits against the lane's target (`origin/main`), and the sidebar's
 *     diff stats count every commit the lane made;
 *   - Compare base = Branch upstream: both show only what is not pushed yet;
 *   - a branch with no upstream says so — in the panel and in the summary —
 *     instead of quietly comparing against the target;
 *   - Group order: the panel lists Changes, Staged or Untracked first, with
 *     the other two after, as chosen.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-git-settings node scripts/e2e/suites/git-settings.mjs
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder. Its work item is deleted in the app, the suite waits until the cloud
 * no longer has it, and the git setting is reset. Screenshots:
 * <e2e out>/screenshots/git-settings-NN-*.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `git-settings-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const lines = (count) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const GROUP_LABELS = ['CONFLICTS', 'CHANGES', 'STAGED', 'UNTRACKED'];

/** origin (bare) with main = [README]; the clone Chord registers. No .chord.json: no prompt. */
function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-git-settings-'));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'git-settings');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# git settings\n');
  writeFileSync(join(author, 'notes.md'), 'notes\n');
  git(author, 'add', '-A');
  git(author, 'commit', '-q', '-m', 'readme');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  return { root, repo };
}

/**
 * The lane as a user would leave it: one commit pushed (3 lines), one not
 * (5 lines), and one change in each group — README edited, notes staged, a
 * new file never added.
 */
function shapeLane(lanePath, branch) {
  writeFileSync(join(lanePath, 'pushed.txt'), lines(3));
  git(lanePath, 'add', 'pushed.txt');
  git(lanePath, 'commit', '-q', '-m', 'pushed work');
  git(lanePath, 'push', '-q', '-u', 'origin', branch);
  writeFileSync(join(lanePath, 'unpushed.txt'), lines(5));
  git(lanePath, 'add', 'unpushed.txt');
  git(lanePath, 'commit', '-q', '-m', 'unpushed work');
  writeFileSync(join(lanePath, 'README.md'), '# git settings\nedited\n');
  writeFileSync(join(lanePath, 'notes.md'), 'notes\nstaged\n');
  git(lanePath, 'add', 'notes.md');
  writeFileSync(join(lanePath, 'brand-new.txt'), lines(2));
}

async function readLaneSummary(account, workItemId, worktreeId) {
  const { summaries } = await account.call('workItems.getSidebarSummaries', [workItemId]);
  return summaries[0].worktrees.find((w) => w.id === worktreeId);
}

async function openChangesPanel(page, workItem) {
  await page.getByText(workItem.name, { exact: true }).first().click();
  // The rail's tab strip is a tablist (activity-bar.tsx).
  const tab = page.getByRole('tab', { name: /^Changes/ }).first();
  await tab.waitFor({ timeout: 15_000 });
  // Clicking the rail panel already shown closes the rail (rail-store.ts activate).
  if ((await page.getByRole('button', { name: 'Refresh changes' }).count()) === 0) {
    await tab.click();
  }
  await page.getByRole('button', { name: 'Refresh changes' }).waitFor({ timeout: 15_000 });
}

/** The panel's group headers, top to bottom. */
async function readGroupOrder(page) {
  // A first open can still be reading the status: wait for a group to draw.
  await page
    .locator('button[aria-expanded]')
    .filter({ hasText: /^(CHANGES|STAGED|UNTRACKED)/ })
    .first()
    .waitFor({ timeout: 15_000 });
  return page.$$eval(
    'button[aria-expanded] span',
    (spans, labels) => spans.map((s) => s.textContent.trim()).filter((t) => labels.includes(t)),
    GROUP_LABELS
  );
}

/** Picks the committed comparison ("vs …") in the second scope row; returns its label. */
async function showCommitted(page) {
  await page
    .getByRole('button', { name: /^(Uncommitted|vs .+)$/ })
    .first()
    .click();
  const item = page.getByRole('menuitem', { name: /^vs / });
  await item.waitFor({ timeout: 10_000 });
  const label = (await item.innerText()).trim();
  await item.click();
  return label;
}

async function showUncommitted(page) {
  await page
    .getByRole('button', { name: /^(Uncommitted|vs .+)$/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Uncommitted' }).click();
}

async function listedFiles(page) {
  await page.waitForTimeout(1500);
  return page.$$eval('button[title]', (buttons) =>
    buttons.map((b) => b.getAttribute('title')).filter((t) => /\.(txt|md)$/.test(t))
  );
}

async function chooseInSettings(page, groupLabel, optionLabel) {
  await page.getByTitle('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Git', exact: true }).first().click();
  const group = page.getByRole('group', { name: groupLabel });
  await group.waitFor({ timeout: 15_000 });
  await group.getByRole('button', { name: optionLabel, exact: true }).click();
  await page.waitForTimeout(500);
}

async function checkCompareBase(account, page, workItem, lane) {
  const target = 'origin/main';
  const upstreamRef = `origin/${lane.branchName}`;

  await openChangesPanel(page, workItem);
  const repoLabel = await showCommitted(page);
  const repoFiles = await listedFiles(page);
  await page.screenshot({ path: shot('committed-vs-target') });
  verdict(
    'repoDefault: the panel compares against the lane’s target',
    repoLabel === `vs ${target}`,
    `label "${repoLabel}"`
  );
  verdict(
    'repoDefault: pushed and unpushed commits are both listed',
    repoFiles.includes('pushed.txt') && repoFiles.includes('unpushed.txt'),
    repoFiles.join(', ')
  );
  const repoSummary = await readLaneSummary(account, workItem.id, lane.id);

  // devstation-e7t: while the summaries for the new compare base load, the
  // sidebar's rows keep their place (they reordered and lost their stats).
  const rowNames = () =>
    page
      .locator('[data-sidebar-row]')
      .evaluateAll((rows) => rows.map((row) => row.innerText.split('\n')[0].trim()));
  await page.getByTitle('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Git', exact: true }).first().click();
  const compareGroup = page.getByRole('group', { name: 'Compare base' });
  await compareGroup.waitFor({ timeout: 15_000 });
  const orderBefore = (await rowNames()).join(' | ');
  await compareGroup.getByRole('button', { name: 'Branch upstream', exact: true }).click();
  const ordersSeen = new Set();
  for (let sample = 0; sample < 30; sample++) {
    ordersSeen.add((await rowNames()).join(' | '));
    await page.waitForTimeout(50);
  }
  verdict(
    'e7t: sidebar rows keep their order while the new compare base loads',
    ordersSeen.size === 1 && ordersSeen.has(orderBefore),
    [...ordersSeen].join(' // ').slice(0, 300)
  );
  await page.screenshot({ path: shot('settings-compare-upstream') });
  const stored = await account.instance.rpc('appSettings.get', 'git');
  verdict('the choice is stored', stored.compareBase === 'upstream', JSON.stringify(stored));

  await openChangesPanel(page, workItem);
  const upLabel = await showCommitted(page);
  const upFiles = await listedFiles(page);
  await page.screenshot({ path: shot('committed-vs-upstream') });
  verdict(
    'upstream: the panel compares against the branch’s upstream',
    upLabel === `vs ${upstreamRef}`,
    `label "${upLabel}"`
  );
  verdict(
    'upstream: only the unpushed commit is listed',
    upFiles.includes('unpushed.txt') && !upFiles.includes('pushed.txt'),
    upFiles.join(', ')
  );
  const upSummary = await readLaneSummary(account, workItem.id, lane.id);
  verdict(
    'sidebar summary names the upstream as the base',
    upSummary.compareBase?.kind === 'ref' && upSummary.compareBase.ref === upstreamRef,
    JSON.stringify(upSummary.compareBase)
  );
  verdict(
    'sidebar +/− drops exactly the pushed commit’s 3 lines',
    repoSummary.diffStats !== null &&
      upSummary.diffStats !== null &&
      repoSummary.diffStats.added - upSummary.diffStats.added === 3,
    `repoDefault ${JSON.stringify(repoSummary.diffStats)}, upstream ${JSON.stringify(upSummary.diffStats)}`
  );

  // The branch's remote copy is deleted: the panel and the summary say it has
  // no upstream. Unsetting the tracking is not enough — the copy would still be
  // where Push writes, and the compare base reads that copy (devstation-ama).
  git(lane.path, 'push', '-q', 'origin', '--delete', lane.branchName);
  git(lane.path, 'fetch', '-q', '--prune', 'origin');
  await page.getByRole('button', { name: 'Refresh changes' }).click();
  const notice = page.getByText(/has no upstream/);
  await notice.waitFor({ timeout: 20_000 });
  // The sidebar row shows the same lane: Refresh re-reads it too, rather than
  // leaving "+9 −0" up until its next 10 s poll (devstation-e7t).
  const itemRow = page.locator('[data-sidebar-row]').filter({ hasText: workItem.name }).first();
  const rowSaysNoUpstream = await itemRow
    .getByText('no upstream')
    .waitFor({ timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: shot('no-upstream') });
  verdict('no upstream: the panel says so', await notice.isVisible(), await notice.innerText());
  verdict(
    'e7t: the sidebar row says no upstream right after Refresh',
    rowSaysNoUpstream,
    (await itemRow.innerText()).replace(/\s+/g, ' ')
  );
  const noneFiles = await listedFiles(page);
  verdict(
    'no upstream: nothing is listed against another base',
    !noneFiles.includes('pushed.txt') && !noneFiles.includes('unpushed.txt'),
    noneFiles.join(', ') || 'no files'
  );
  const noneSummary = await readLaneSummary(account, workItem.id, lane.id);
  verdict(
    'no upstream: the summary is typed, with no +/− from the target',
    noneSummary.compareBase?.kind === 'no_upstream' && noneSummary.diffStats === null,
    `${JSON.stringify(noneSummary.compareBase)} ${JSON.stringify(noneSummary.diffStats)}`
  );
  await showUncommitted(page);
}

async function checkGroupOrder(account, page, workItem) {
  await openChangesPanel(page, workItem);
  let order = await readGroupOrder(page);
  await page.screenshot({ path: shot('order-changes') });
  verdict(
    'default order: Changes, Staged, Untracked',
    order.join(',') === 'CHANGES,STAGED,UNTRACKED',
    order.join(', ')
  );

  await chooseInSettings(page, 'Source control group order', 'Untracked');
  await page.screenshot({ path: shot('settings-order-untracked') });
  await openChangesPanel(page, workItem);
  order = await readGroupOrder(page);
  await page.screenshot({ path: shot('order-untracked') });
  verdict(
    'Untracked first: Untracked, Changes, Staged',
    order.join(',') === 'UNTRACKED,CHANGES,STAGED',
    order.join(', ')
  );

  await chooseInSettings(page, 'Source control group order', 'Staged');
  await openChangesPanel(page, workItem);
  order = await readGroupOrder(page);
  await page.screenshot({ path: shot('order-staged') });
  verdict(
    'Staged first: Staged, Changes, Untracked',
    order.join(',') === 'STAGED,CHANGES,UNTRACKED',
    order.join(', ')
  );
  const stored = await account.instance.rpc('appSettings.get', 'git');
  verdict(
    'the order is stored',
    stored.sourceControlGroupOrder === 'staged',
    JSON.stringify(stored)
  );
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'git-settings' });
  const { page } = account.instance;
  let workItem = null;
  try {
    await account.instance.rpc('appSettings.reset', 'git');
    const { repo } = await account.call('repos.create', {
      path: scratch.repo,
      alias: 'git-settings',
    });
    const created = await account.call('workItems.create', {
      name: `Chord e2e git settings ${Date.now()}`,
      repoId: repo.id,
    });
    workItem = created.item;
    await waitFor(
      async () => {
        const { items } = await account.call('workItems.getAll');
        workItem = items.find((w) => w.id === workItem.id);
        return workItem?.provisionStatus === 'ready';
      },
      120_000,
      'the work item to be checked out'
    );
    const { worktrees } = await account.call('worktrees.list', workItem.id);
    const lane = worktrees.find((w) => w.isPrimary);
    shapeLane(lane.path, lane.branchName);

    await checkGroupOrder(account, page, workItem);
    await checkCompareBase(account, page, workItem, lane);
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    await account.instance.rpc('appSettings.reset', 'git');
    if (workItem) {
      await account.call('workItems.remove', workItem.id);
      await waitFor(
        async () => (await account.api('GET', `/work-items/${workItem.id}`)).status === 404,
        60_000,
        'the cloud to drop the run’s work item'
      );
    }
    await account.close();
    rmSync(scratch.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
