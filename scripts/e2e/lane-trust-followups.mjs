/**
 * Live checks for the Phase 2 follow-ups, driven through the real UI:
 *   - devstation-b7y: the "Run scripts?" window is answered by the suite
 *     (`trust-prompt.mjs`), not by a person;
 *   - devstation-0nu: with Settings › Open agents in › Terminal, the + menu's
 *     Claude row opens Claude Code in a terminal in the lane, and Claude does
 *     not ask to trust the folder (Chord pre-accepted it, key with `/`);
 *     "Agent settings…" opens that card;
 *   - devstation-1q1: with the main checkout on a branch without the base's
 *     .chord.json, the repository page says team edits can't be saved there,
 *     offers no Save to team file, and nothing is written.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-followups node scripts/e2e/lane-trust-followups.mjs
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder. Its work item is deleted in the app, and the suite waits until the
 * cloud no longer has it. Screenshots: screenshots/e2e/lane-followups-*.png.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { E2E_SHOTS_DIR } from './experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from './sharing/sharing-accounts.mjs';
import { answerTrustPrompt, isTrustPromptClosed } from './trust-prompt.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `lane-followups-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
// eslint-disable-next-line no-control-regex
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '');

/** origin (bare) with main = [readme, .chord.json setup]; the main checkout on a branch without it. */
function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-followups-'));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'lanes-followups');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  for (const dir of [author]) {
    git(dir, 'config', 'user.email', 'e2e@chord.invalid');
    git(dir, 'config', 'user.name', 'Chord e2e');
  }
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# followups\n');
  git(author, 'add', 'README.md');
  git(author, 'commit', '-q', '-m', 'readme');
  writeFileSync(
    join(author, '.chord.json'),
    `${JSON.stringify({ scripts: { setup: 'echo followups-setup> setup-ran.txt' } }, null, 2)}\n`
  );
  git(author, 'add', '.chord.json');
  git(author, 'commit', '-q', '-m', 'team config');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  git(repo, 'checkout', '-q', '-b', 'feat/no-config', 'HEAD~1');
  return { root, repo };
}

/**
 * The terminal's ring buffer. Not unsubscribed after: consumers are one set
 * per session, so that would also drop the open terminal pane's registration.
 */
async function readPtyText(account, sessionId) {
  const { buffer } = await account.call('pty.subscribe', `session:${sessionId}`);
  return stripAnsi(buffer);
}

async function checkClaudeTerminal(account, page, workItem) {
  const { app } = account.instance;
  await page.getByText(workItem.name, { exact: true }).first().click();
  await page.getByRole('button', { name: 'New session' }).click();
  // The row's accessible name also carries its logo's alt text.
  const claudeRow = page.getByRole('menuitem').filter({ hasText: /^\s*Claude Code\s*$/ });
  await claudeRow.waitFor({ timeout: 15_000 });
  const rowTitle = await claudeRow.getAttribute('title');
  verdict(
    'agent row follows the setting',
    rowTitle === 'Open Claude Code in a terminal',
    `title: ${rowTitle}`
  );
  verdict(
    'menu offers Agent settings…',
    await page.getByRole('menuitem', { name: 'Agent settings…' }).isVisible(),
    'row visible in the + menu'
  );
  await page.screenshot({ path: shot('plus-menu') });
  await claudeRow.click();

  let terminal = null;
  await waitFor(
    async () => {
      const { sessions } = await account.call('agentSessions.getAll', workItem.id);
      terminal = sessions.find((s) => s.kind === 'terminal' && s.agentProviderId === 'claude');
      return terminal !== undefined && terminal !== null;
    },
    30_000,
    'a Claude terminal session'
  );
  verdict(
    'Claude row opened a terminal session',
    terminal.communication === 'pty',
    `session ${terminal.id}`
  );

  // Claude Code's own prompt reads "Do you trust the files in this folder?".
  let text = '';
  await waitFor(
    async () => {
      text = await readPtyText(account, terminal.id);
      // Its header ("Claude Code v2.1…") and input hint ("shift+tab to cycle")
      // draw only once past the trust dialog; the dialog draws its own text.
      return /trust the files|shift\s*\+\s*tab/i.test(text);
    },
    90_000,
    'Claude Code to draw its first screen'
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('claude-terminal') });
  const asked = /trust the files|Do you trust/i.test(text);
  verdict(
    'Claude did not ask to trust the folder',
    !asked,
    asked ? 'trust dialog shown' : 'no trust dialog'
  );

  const { worktrees } = await account.call('worktrees.list', workItem.id);
  const lanePath = resolve(worktrees.find((w) => w.id === terminal.worktreeId).path);
  const key = lanePath.replace(/\\/g, '/');
  const projects = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).projects ?? {};
  verdict(
    '~/.claude.json pre-accepts the lane with a forward-slash key',
    projects[key]?.hasTrustDialogAccepted === true,
    key
  );
  verdict('no Run scripts? window left open', await isTrustPromptClosed(app), 'checked windows');

  await account.call('agentSessions.remove', terminal.id);
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByRole('menuitem', { name: 'Agent settings…' }).click();
  const card = page.getByText('Open agents in', { exact: true }).first();
  await card.waitFor({ timeout: 15_000 });
  await page.screenshot({ path: shot('agent-settings') });
  verdict('Agent settings… opens the Open agents in card', await card.isVisible(), 'card visible');
}

async function checkTeamWriteRefused(page, alias, repo) {
  // The options button shows on hover of the repository's header.
  await page.getByText(alias, { exact: true }).first().hover();
  await page.getByRole('button', { name: `${alias} options` }).click();
  await page.getByRole('menuitem', { name: 'Repository settings' }).click();
  const notice = page.getByText(/Team edits can't be saved there/);
  await notice.waitFor({ timeout: 20_000 });
  verdict(
    'repository page says why team edits are refused',
    /feat\/no-config.*origin\/main/.test(await notice.innerText()),
    await notice.innerText()
  );
  await page.screenshot({ path: shot('repo-page-notice') });

  const runField = page
    .getByText('Run', { exact: true })
    // The whole field (header row, editor and its buttons), not the header row.
    .locator('xpath=ancestor::div[contains(@class,"flex-col") and contains(@class,"gap-2")][1]');
  await runField.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Run' }).fill('pnpm dev');
  await page.screenshot({ path: shot('run-editor') });
  // A save the app would refuse is not offered; this machine's value still is.
  verdict(
    'Save to team file is not offered while refused',
    (await runField.getByRole('button', { name: 'Save to team file' }).count()) === 0 &&
      (await runField.getByRole('button', { name: 'Save for me' }).isVisible()),
    'only Save for me and Cancel'
  );
  await runField.getByRole('button', { name: 'Cancel' }).click();

  // Files to copy is a team setting only: nothing to edit it into.
  const filesField = page
    .getByText('Files to copy', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"flex-col") and contains(@class,"gap-2")][1]');
  await filesField.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('files-no-edit') });
  verdict(
    'a team-only field offers no Edit while refused',
    (await filesField.getByRole('button', { name: 'Edit' }).count()) === 0,
    'Files to copy has no Edit'
  );
  verdict(
    'the main checkout has no .chord.json written',
    !existsSync(join(repo, '.chord.json')),
    `${join(repo, '.chord.json')} absent`
  );
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'followups' });
  const { page, app } = account.instance;
  let workItem = null;
  try {
    const alias = 'lanes-followups';
    const { repo } = await account.call('repos.create', { path: scratch.repo, alias });
    await account.instance.rpc('appSettings.update', 'agentLaunch', { openAgentsIn: 'terminal' });

    const created = await account.call('workItems.create', {
      name: `Chord e2e followups ${Date.now()}`,
      repoId: repo.id,
    });
    workItem = created.item;
    const promptText = await answerTrustPrompt(app, 'decline', {
      timeoutMs: 90_000,
      shotPath: shot('setup-prompt'),
    });
    verdict(
      'b7y: the suite answered the Run scripts? window',
      /followups-setup/.test(promptText),
      'prompt showed the setup script; answered Don’t run'
    );
    await waitFor(
      async () => {
        const { items } = await account.call('workItems.getAll');
        workItem = items.find((w) => w.id === workItem.id);
        return workItem?.provisionStatus === 'ready';
      },
      120_000,
      'the work item to be checked out'
    );

    await checkClaudeTerminal(account, page, workItem);
    await checkTeamWriteRefused(page, alias, scratch.repo);
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
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
