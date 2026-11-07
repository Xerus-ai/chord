/**
 * Live check for plan §Phase 3 slice 6 (devstation-arx.8), driven through the
 * real UI: a Claude Code worktree with a Claude session in it appears under
 * its repository, is adopted with its session, and stays the user's.
 *
 *   1. The scratch repository has a `.claude/worktrees/x` checkout (where
 *      Claude Code puts its worktrees) and one elsewhere; `claude -p` runs in
 *      the first, outside Chord, and is told a code word.
 *   2. The rail lists the Claude Code worktree under its repository with
 *      Adopt, and counts the other one in a single "Review 1 worktree" line.
 *   3. Adopt's dialog names the item after the session found in the folder,
 *      with that session ticked. Adopting makes one primary lane on the
 *      folder, marked adopted, setup not run, with the session imported; the
 *      chat shows its history.
 *   4. The bar reads "Adopted — setup not run". Run setup runs the approved
 *      setup script and copies the missing files, but the folder's own `.env`
 *      survives.
 *   5. Delete's confirm says the checkpoints go and the folder stays. After
 *      it, the folder, its branch and `git worktree list` are unchanged, no
 *      teardown ran and no "Run scripts?" window opened; the folder is
 *      offered for adoption again.
 *   6. "Hide for this repo" takes the review line away.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-adopt node scripts/e2e/suites/adopt-worktree.mjs
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder; its `.chord.json` has a setup and a teardown script that each write
 * a marker file. The run's work item is deleted in the app and the suite
 * waits until the cloud no longer has it; the Claude project folder the
 * outside session wrote is removed. Screenshots (and the run record, through
 * `launchSeededApp`): <e2e out>/screenshots/adopt-worktree-*.png.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';
import { answerTrustPrompt, isTrustPromptClosed } from '../lib/trust-prompt.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `adopt-worktree-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const markerScript = (file) => `node -e "require('fs').writeFileSync('${file}','ran')"`;
const BRANCH = 'claude/adopt-x';

/**
 * origin (bare) with main = [readme, .gitignore of `.env*`, .chord.json with a
 * setup and a teardown script]; the clone Chord registers, holding `.env` and
 * `.env.local` to copy; a Claude Code worktree with its own `.env`; and one
 * worktree elsewhere.
 */
function createScratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-adopt-')));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'adopt-worktree');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# adopt worktree\n');
  writeFileSync(join(author, '.gitignore'), '.env*\nsetup-ran.txt\nteardown-ran.txt\n');
  writeFileSync(
    join(author, '.chord.json'),
    JSON.stringify({
      scripts: { setup: markerScript('setup-ran.txt'), teardown: markerScript('teardown-ran.txt') },
    })
  );
  git(author, 'add', '.');
  git(author, 'commit', '-q', '-m', 'init');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  writeFileSync(join(repo, '.env'), 'FROM=main\n');
  writeFileSync(join(repo, '.env.local'), 'LOCAL=main\n');

  const claudeDir = resolve(repo, '.claude', 'worktrees', 'x');
  git(repo, 'worktree', 'add', '-q', '-b', BRANCH, claudeDir, 'main');
  writeFileSync(join(claudeDir, '.env'), 'FROM=worktree\n');
  const sideDir = resolve(root, 'side');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/side', sideDir, 'main');
  return { root, repo, claudeDir, sideDir };
}

/** Claude Code's transcript folder for `cwd` (same encoding as session-import.mjs). */
function claudeProjectDir(cwd) {
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, '-');
  if (encoded.length > 200) throw new Error(`worktree path too long for this suite: ${cwd}`);
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return join(configDir, 'projects', encoded);
}

function runOutsideClaude(cwd, prompt) {
  const run = spawnSync('claude', ['-p', '--output-format', 'json'], {
    cwd,
    input: prompt,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 180_000,
  });
  if (run.status !== 0)
    throw new Error(`claude -p exited ${run.status}: ${run.stderr || run.stdout}`);
  return JSON.parse(run.stdout);
}

/** A CSS attribute selector for a Windows path: JSON escapes the backslashes CSS needs escaped. */
const discoveredRow = (page, folder) =>
  page.locator(`[data-discovered-worktree=${JSON.stringify(folder)}]`);

async function checkListing(page, repoId, scratch) {
  const row = discoveredRow(page, scratch.claudeDir);
  await row.waitFor({ timeout: 60_000 });
  await page.screenshot({ path: shot('listed-under-repo') });
  verdict(
    'the Claude Code worktree is listed under its repository with Adopt',
    (await row.getAttribute('data-repo-id')) === repoId &&
      (await row.getByRole('button', { name: 'Adopt' }).isVisible()),
    (await row.innerText()).replace(/\s+/g, ' ')
  );
  const review = page.locator(`[data-worktree-review="${repoId}"]`);
  const reviewText = (await review.innerText().catch(() => '')).replace(/\s+/g, ' ');
  verdict(
    'the other worktree is counted in one review line, not listed',
    reviewText.includes('Review 1 worktree') &&
      (await discoveredRow(page, scratch.sideDir).count()) === 0,
    reviewText
  );
  return row;
}

async function adoptThroughDialog(page, row, outsideId) {
  await row.getByRole('button', { name: 'Adopt' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Adopt' });
  const sessionRow = dialog.locator(`[data-adopt-session="${outsideId}"]`);
  await sessionRow.waitFor({ timeout: 60_000 });
  const name = await dialog.getByLabel('Name').inputValue();
  const ticked = await sessionRow.getByRole('checkbox').isChecked();
  await page.screenshot({ path: shot('adopt-dialog') });
  verdict(
    'the dialog names the item after the session found there, with it ticked',
    ticked && name.trim().length > 0 && name !== BRANCH,
    `name ${JSON.stringify(name)}, ticked ${ticked}`
  );
  await dialog.getByRole('button', { name: 'Adopt' }).click();
  return name;
}

async function checkAdopted(account, page, scratch, outsideId, codeWord) {
  let workItem = null;
  await waitFor(
    async () => {
      const { items } = await account.call('workItems.getAll');
      workItem = items.find((w) => resolve(w.repoPath) === scratch.claudeDir) ?? null;
      return workItem !== null;
    },
    60_000,
    'the adopted work item'
  );
  const { worktrees } = await account.call('worktrees.list', workItem.id);
  const lane = worktrees[0];
  verdict(
    'one primary lane on the folder, adopted, setup not run',
    worktrees.length === 1 &&
      lane.isPrimary &&
      resolve(lane.path) === scratch.claudeDir &&
      lane.branchName === BRANCH &&
      lane.checkoutOrigin === 'adopted' &&
      lane.setupStatus === 'skipped',
    JSON.stringify(worktrees)
  );
  const { sessions } = await account.call('agentSessions.getAll', workItem.id);
  const imported = sessions.find((s) => s.externalSessionId === outsideId);
  verdict(
    'the ticked session was imported onto the lane',
    imported?.worktreeId === lane.id && imported?.kind === 'chat',
    JSON.stringify(imported ?? null)
  );

  await page.getByText(workItem.name, { exact: true }).first().click();
  const earlier = page.getByText(`Remember the code word ${codeWord}`).first();
  await earlier.waitFor({ timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: shot('adopted-chat') });
  verdict('the chat shows the session’s history', await earlier.isVisible(), codeWord);
  return { workItem, lane };
}

async function checkRunSetup(account, page, app, scratch, lane) {
  const bar = page.getByText('Adopted — setup not run').first();
  await bar.waitFor({ timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: shot('setup-not-run-bar') });
  verdict('the bar says the adopted checkout has not had setup run', await bar.isVisible(), 'bar');

  await page.getByRole('button', { name: 'Run setup' }).click();
  await answerTrustPrompt(app, 'run', { shotPath: shot('run-setup-prompt') });
  await waitFor(
    async () =>
      (await account.call('worktrees.list', lane.workItemId)).worktrees[0].setupStatus === 'ok',
    60_000,
    'setup to finish'
  );
  const { log } = await account.call('worktrees.getSetupLog', lane.id);
  const env = readFileSync(join(scratch.claudeDir, '.env'), 'utf8');
  const copied = existsSync(join(scratch.claudeDir, '.env.local'))
    ? readFileSync(join(scratch.claudeDir, '.env.local'), 'utf8')
    : null;
  await page.screenshot({ path: shot('after-run-setup') });
  verdict(
    "Run setup keeps the folder's .env, copies what is missing, and logs what it kept",
    env === 'FROM=worktree\n' &&
      copied === 'LOCAL=main\n' &&
      existsSync(join(scratch.claudeDir, 'setup-ran.txt')) &&
      /already/i.test(log),
    `.env ${JSON.stringify(env)}, .env.local ${JSON.stringify(copied)}; log: ${log.replace(/\s+/g, ' ')}`
  );
}

async function deleteThroughRail(account, page, app, scratch, workItem, worktreesBefore) {
  const envBefore = readFileSync(join(scratch.claudeDir, '.env'), 'utf8');
  const headBefore = git(scratch.claudeDir, 'rev-parse', 'HEAD');
  await page.getByText(workItem.name, { exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: `Delete "${workItem.name}"?` });
  await dialog.waitFor({ timeout: 10_000 });
  const confirmText = (await dialog.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: shot('delete-confirm') });
  verdict(
    'the confirm says the checkpoints go and the folder and branch stay',
    /checkpoints/.test(confirmText) &&
      confirmText.includes(scratch.claudeDir) &&
      /stay/.test(confirmText),
    confirmText
  );
  await dialog.getByRole('button', { name: /^Delete/ }).click();
  await waitFor(
    async () => !(await account.call('workItems.getAll')).items.some((w) => w.id === workItem.id),
    60_000,
    'the work item to be deleted'
  );

  verdict(
    "Delete leaves the folder, its branch and git's worktree list unchanged",
    existsSync(scratch.claudeDir) &&
      git(scratch.claudeDir, 'rev-parse', 'HEAD') === headBefore &&
      readFileSync(join(scratch.claudeDir, '.env'), 'utf8') === envBefore &&
      git(scratch.repo, 'branch', '--list', BRANCH) !== '' &&
      git(scratch.repo, 'worktree', 'list', '--porcelain') === worktreesBefore,
    git(scratch.repo, 'worktree', 'list')
  );
  verdict(
    'no teardown ran, and no "Run scripts?" window asked about one',
    !existsSync(join(scratch.claudeDir, 'teardown-ran.txt')) && (await isTrustPromptClosed(app)),
    `teardown marker: ${existsSync(join(scratch.claudeDir, 'teardown-ran.txt'))}`
  );
  const again = discoveredRow(page, scratch.claudeDir);
  await again.waitFor({ timeout: 60_000 }).catch(() => {});
  await page.screenshot({ path: shot('offered-again') });
  verdict('the folder is offered for adoption again', await again.isVisible(), 'listed');
}

async function checkHideForRepo(page, repoId) {
  const review = page.locator(`[data-worktree-review="${repoId}"]`);
  await review.getByRole('button', { name: 'Hide for this repo' }).click();
  await review.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  await page.screenshot({ path: shot('review-hidden') });
  verdict('"Hide for this repo" takes the review line away', (await review.count()) === 0, 'line');
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const projectDir = claudeProjectDir(scratch.claudeDir);
  const codeWord = `WOMBAT${randomInt(1000, 9999)}`;
  const outside = runOutsideClaude(
    scratch.claudeDir,
    `Remember the code word ${codeWord}. Reply with just: ok`
  );
  verdict(
    'an outside Claude session ran in the Claude Code worktree',
    existsSync(join(projectDir, `${outside.session_id}.jsonl`)),
    `session ${outside.session_id}`
  );
  const worktreesBefore = git(scratch.repo, 'worktree', 'list', '--porcelain');

  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'adopt-worktree' });
  const { page, app } = account.instance;
  let workItem = null;
  let deleted = false;
  try {
    const { repo } = await account.call('repos.create', {
      path: scratch.repo,
      alias: 'adopt-worktree',
    });
    const row = await checkListing(page, repo.id, scratch);
    await adoptThroughDialog(page, row, outside.session_id);
    const adopted = await checkAdopted(account, page, scratch, outside.session_id, codeWord);
    workItem = adopted.workItem;
    await checkRunSetup(account, page, app, scratch, adopted.lane);
    await deleteThroughRail(account, page, app, scratch, workItem, worktreesBefore);
    deleted = true;
    await checkHideForRepo(page, repo.id);
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
    // The suite made these worktrees; Chord must not have removed them, so remove them here.
    for (const dir of [scratch.claudeDir, scratch.sideDir]) {
      if (existsSync(dir)) git(scratch.repo, 'worktree', 'remove', '--force', dir);
    }
    rmSync(scratch.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (projectDir.includes('adopt')) {
      rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
