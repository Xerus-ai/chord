/**
 * Live check for the companion repository setting (devstation-4x42.242,
 * .243), driven through the real UI:
 *
 *   1. Repo › General shows a Companion repository row, None at first.
 *   2. Choose… picks the companion's main checkout; the folder the repository
 *      sits at inside it is suggested. A folder outside the companion is
 *      refused in place, and nothing is saved.
 *   3. Saved, the row shows the companion and the folder, marked Just me.
 *   4. A new work item's lane is the pair: the companion's worktree at
 *      <pool>/<slug> on companion/<branch>, the lane's checkout nested in it,
 *      and the companion stays clean. The header names the companion checkout.
 *   5. A chat of the lane starts at the companion's root.
 *   6. Deleting the work item removes the companion worktree with the lane.
 *   7. Remove clears the setting: the row reads None again.
 *
 * The OS folder picker is the one thing not driven: Playwright cannot click a
 * native dialog, so the main process's `dialog.showOpenDialog` answers with
 * the scratch companion's folder. Everything after it is the real app.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-companion node scripts/e2e/suites/companion-repo.mjs
 *
 * Scratch repositories under the OS temp folder: a bare origin, the companion
 * (it ignores `/app/`), and the repository Chord registers, cloned at
 * `<companion>/app`. The run's work item is deleted in the app and the suite
 * waits until the cloud no longer has it. Screenshots:
 * <e2e out>/screenshots/companion-repo-*.png.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';

const SEED_PROFILE = process.env.CHORD_E2E_PROFILE ?? 'chord-p1-smoke';
const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `companion-repo-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const ALIAS = 'companion-app';

function identify(dir) {
  git(dir, 'config', 'user.email', 'e2e@chord.invalid');
  git(dir, 'config', 'user.name', 'Chord e2e');
}

/** origin (bare) with main = [README]; the companion; the repository cloned at <companion>/app. */
function createScratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-companion-')));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const companion = join(root, 'companion');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  identify(author);
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# companion app\n');
  git(author, 'add', '.');
  git(author, 'commit', '-q', '-m', 'init');
  git(author, 'push', '-q', 'origin', 'main');

  git(root, 'init', '-q', '-b', 'main', companion);
  identify(companion);
  writeFileSync(join(companion, '.gitignore'), '/app/\n');
  writeFileSync(join(companion, 'NOTES.md'), '# notes around the app\n');
  git(companion, 'add', '.');
  git(companion, 'commit', '-q', '-m', 'companion');
  const repo = join(companion, 'app');
  git(root, 'clone', '-q', origin, repo);
  identify(repo);
  return { root, companion, repo };
}

/** The OS folder picker answers with `folder` (see the header). */
async function answerFolderPicker(app, folder) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, folder);
}

/** Settings › the repository in the rail's Repositories group (the sidebar lists it only with items). */
async function openRepoSettings(page) {
  await page.getByTitle('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Back to app' }).waitFor({ timeout: 15_000 });
  await page.locator('nav').getByRole('button').filter({ hasText: ALIAS }).first().click();
  const row = page.getByTestId('repo-companion-row');
  await row.waitFor({ timeout: 20_000 });
  await row.scrollIntoViewIfNeeded();
  return row;
}

async function checkSetting(account, page, app, repoId, scratch) {
  const row = await openRepoSettings(page);
  await page.screenshot({ path: shot('row-none') });
  verdict(
    'Repo › General shows Companion repository, None',
    /None/.test(await row.innerText()),
    (await row.innerText()).replace(/\s+/g, ' ')
  );

  await answerFolderPicker(app, scratch.companion);
  await row.getByRole('button', { name: 'Choose…' }).click();
  const folder = row.getByRole('textbox');
  await folder.waitFor({ timeout: 10_000 });
  verdict(
    'the folder the repository sits at inside the companion is suggested',
    (await folder.inputValue()) === 'app',
    `"${await folder.inputValue()}"`
  );

  await folder.fill('../app');
  await row.getByRole('button', { name: 'Save for me' }).click();
  const alert = row.getByRole('alert');
  await alert.waitFor({ timeout: 10_000 });
  await page.screenshot({ path: shot('refused-in-place') });
  const saved = (await account.call('repoSettings.get', repoId)).justMe;
  verdict(
    'a folder outside the companion is refused in place, and nothing is saved',
    /inside the companion/.test(await alert.innerText()) && saved.companionRepo === undefined,
    await alert.innerText()
  );

  await folder.fill('app');
  await row.getByRole('button', { name: 'Save for me' }).click();
  await waitFor(
    async () => (await account.call('repoSettings.get', repoId)).justMe.companionRepo !== undefined,
    10_000,
    'the companion to be saved'
  );
  await row.getByText(`${ALIAS} at app`).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: shot('row-saved') });
  const stored = (await account.call('repoSettings.get', repoId)).justMe.companionRepo;
  verdict(
    'saved, the row shows the companion and the folder, as Just me',
    stored.path === scratch.companion &&
      stored.appFolder === 'app' &&
      (await row.getByText('Just me').count()) > 0,
    JSON.stringify(stored)
  );
}

async function checkLane(account, page, workItem) {
  const { worktrees } = await account.call('worktrees.list', workItem.id);
  const lane = worktrees.find((w) => w.isPrimary);
  const companionPath = lane.companionPath;
  verdict(
    "the lane's checkout is nested in the companion's worktree",
    companionPath !== null && lane.path === join(companionPath, 'app') && existsSync(lane.path),
    `${lane.path} in ${companionPath}`
  );
  verdict(
    'the companion worktree is on companion/<branch> and stays clean',
    git(companionPath, 'branch', '--show-current') === `companion/${lane.branchName}` &&
      git(companionPath, 'status', '--porcelain') === '' &&
      existsSync(join(companionPath, 'NOTES.md')),
    `${git(companionPath, 'branch', '--show-current')}, status "${git(companionPath, 'status', '--porcelain')}"`
  );

  await page.getByRole('button', { name: 'Back to app' }).click();
  await page.getByText(workItem.name, { exact: true }).first().click();
  const chip = page.getByTestId('header-companion-chip');
  await chip.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: shot('header-companion-chip') });
  verdict(
    'the header names the companion checkout',
    (await chip.getAttribute('title')) === `Companion checkout: ${companionPath}`,
    `${await chip.innerText()} — ${await chip.getAttribute('title')}`
  );

  const { session } = await account.call('agentSessions.create', {
    workItemId: workItem.id,
    kind: 'chat',
    agentProviderId: 'claude',
  });
  verdict(
    'a chat of the lane starts at the companion root',
    session.cwd === companionPath,
    session.cwd
  );
  return { companionPath };
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratch();
  const account = await launchAccount({ seedProfile: SEED_PROFILE, label: 'companion-repo' });
  const { page, app } = account.instance;
  let workItem = null;
  let deleted = false;
  try {
    const { repo } = await account.call('repos.create', { path: scratch.repo, alias: ALIAS });
    await checkSetting(account, page, app, repo.id, scratch);

    const created = await account.call('workItems.create', {
      name: `Chord e2e companion ${Date.now()}`,
      repoId: repo.id,
    });
    workItem = created.item;
    await waitFor(
      async () => {
        const { items } = await account.call('workItems.getAll');
        workItem = items.find((w) => w.id === workItem.id);
        return workItem?.provisionStatus === 'ready' || workItem?.provisionStatus === 'failed';
      },
      120_000,
      'the work item to be checked out'
    );
    if (workItem.provisionStatus !== 'ready') {
      throw new Error(`Provisioning failed: ${workItem.provisionError}`);
    }
    const { companionPath } = await checkLane(account, page, workItem);

    await page.getByRole('button', { name: 'Dashboard' }).click();
    await account.call('workItems.remove', workItem.id);
    deleted = true;
    const row = page.locator('[data-sidebar-row]').filter({ hasText: workItem.name });
    await waitFor(async () => (await row.count()) === 0, 30_000, 'the item to leave the sidebar');
    const removed =
      !existsSync(companionPath) &&
      !git(scratch.companion, 'worktree', 'list').includes(companionPath.replaceAll('\\', '/'));
    // What the app said about the removal, when it left something behind.
    const appSaid = removed
      ? ''
      : `${account.instance.readStdout()}\n${account.instance.readStderr()}`
          .split('\n')
          .filter((line) => /worktree|companion|work-items/i.test(line))
          .slice(-12)
          .join('\n');
    verdict(
      'deleting the work item removes the companion worktree with the lane',
      removed,
      `${git(scratch.companion, 'worktree', 'list')}${appSaid ? `\n${appSaid}` : ''}`
    );

    const settingsRow = await openRepoSettings(page);
    await settingsRow.getByRole('button', { name: 'Remove' }).click();
    await settingsRow.getByText('None', { exact: true }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: shot('row-removed') });
    verdict(
      'Remove clears the setting',
      (await account.call('repoSettings.get', repo.id)).justMe.companionRepo === undefined,
      'companionRepo cleared'
    );
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    if (workItem) {
      if (!deleted) await account.call('workItems.remove', workItem.id);
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
