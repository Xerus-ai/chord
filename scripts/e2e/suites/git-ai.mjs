/**
 * Live checks for Git AI (plan 2026-09-26 §Phase 3 slice 4, devstation-arx.9),
 * driven through the real UI with the user's installed Claude Code:
 *   - Settings › Git › AI picks the agent, and says ACP agents may keep their
 *     own record of the temporary session; an agent that isn't signed in is
 *     named on the Generate button, which is disabled (Codex here, run with an
 *     empty CODEX_HOME so it has no login);
 *   - a Generate that fails (a model the account doesn't have) shows the reason
 *     and the agent's output, and leaves the commit field exactly as typed;
 *   - Cancel during a run leaves the field as it was;
 *   - Generate in the commit field fills a message from the staged change, and
 *     the checkout is unchanged (the agent wrote nothing, staged nothing), and
 *     no Claude session was saved for the run;
 *   - Create PR opens with the repository's PR template in the body
 *     (useTemplate) and the draft default; Generate fills title and body from
 *     the lane's commits and the staged change Create PR would commit,
 *     following the template;
 *   - Repo settings › Git AI shows each field's layer; a just-me value set on
 *     one field (PR instructions) overrides only that field, for that repo.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-git-ai node scripts/e2e/suites/git-ai.mjs
 *
 * Scratch repository (bare origin + clone) under the OS temp folder; its origin
 * is then renamed to a GitHub URL whose pushes go to the bare origin, so Create
 * PR is offered and nothing reaches GitHub. No PR is created. The work item is
 * deleted, the suite waits until the cloud drops it, and gitAi is reset.
 * Screenshots: screenshots/e2e/git-ai-NN-*.png.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  openCommitField,
  openGitAiSettings,
  pickGitAiAgent,
  readFailure,
  readSettledLabel,
  runGenerate,
} from '../lib/git-ai-ui.mjs';
import { createReport, openCreatePrForm } from '../lib/pr-per-lane-ui.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';

const report = createReport('git-ai');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const OFFLINE_GITHUB_URL = 'https://github.com/chord-e2e/git-ai.git';
const TEMPLATE = '## Summary\n\n## Test plan\n- [ ] Tested locally\n';
const TYPED = 'my own draft message';

/** origin (bare) with main = [README, .github/pull_request_template.md]; the clone Chord uses. */
function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-git-ai-'));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'git-ai');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  for (const dir of [author]) {
    git(dir, 'config', 'user.email', 'e2e@chord.invalid');
    git(dir, 'config', 'user.name', 'Chord e2e');
  }
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# git ai\n');
  mkdirSync(join(author, '.github'));
  writeFileSync(join(author, '.github', 'pull_request_template.md'), TEMPLATE);
  git(author, 'add', '-A');
  git(author, 'commit', '-q', '-m', 'readme and PR template');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  return { root, origin, repo };
}

/** One commit of the lane's own (for the PR), plus one staged change (for the commit). */
function shapeLane(lanePath) {
  writeFileSync(
    join(lanePath, 'login.ts'),
    'export function login() {\n  redirectTo("/dashboard");\n}\n'
  );
  git(lanePath, 'add', 'login.ts');
  git(lanePath, 'commit', '-q', '-m', 'Redirect to the dashboard after login');
  writeFileSync(
    join(lanePath, 'session.ts'),
    'export const SESSION_TIMEOUT_MINUTES = 30;\nexport function isExpired(startedAt: number) {\n  return Date.now() - startedAt > SESSION_TIMEOUT_MINUTES * 60_000;\n}\n'
  );
  git(lanePath, 'add', 'session.ts');
}

/** The checkout as git sees it: index, working tree and HEAD. */
const checkoutState = (lanePath) =>
  [
    git(lanePath, 'rev-parse', 'HEAD'),
    git(lanePath, 'status', '--porcelain=v1', '--untracked-files=all'),
    git(lanePath, 'diff', '--cached'),
    git(lanePath, 'diff'),
  ].join('\n--\n');

/** Claude's saved conversations for any Git AI run folder (there must be none). */
function savedGitAiSessions() {
  const projects = join(homedir(), '.claude', 'projects');
  if (!existsSync(projects)) return [];
  return readdirSync(projects).filter((name) => /chord-git-ai-run/i.test(name));
}

async function checkSettingsAndNotSignedIn(account, page, item) {
  await pickGitAiAgent(account, page, 'Codex', 'codex');
  await page.screenshot({ path: report.shot('settings-codex') });
  const acpNote = page.getByText(/ACP agents may keep their own record/i);
  report.verdict(
    'Settings says ACP agents may keep their own record of the temporary session',
    (await acpNote.count()) > 0 && (await acpNote.first().isVisible()),
    (await acpNote.count()) > 0 ? await acpNote.first().innerText() : 'note not found'
  );
  const field = await openCommitField(page, item.name);
  await field.message.fill(TYPED);
  const label = await readSettledLabel(field.generate);
  await page.screenshot({ path: report.shot('codex-not-signed-in') });
  report.verdict(
    'an agent that is not signed in is named on the button, disabled',
    label === 'Codex not signed in' && (await field.generate.isDisabled()),
    `label "${label}", title "${await field.generate.getAttribute('title')}"`
  );
  report.verdict(
    'the field keeps what was typed',
    (await field.message.inputValue()) === TYPED,
    `"${await field.message.inputValue()}"`
  );
  await page.keyboard.press('Escape');
}

async function checkRunFailure(account, page, item, lanePath) {
  await pickGitAiAgent(account, page, 'Claude Code', 'claude');
  const settings = await account.call('gitAi.getSettings', { repoId: null });
  // Not offered by the picker: a model id the account has no access to.
  await account.instance.rpc('appSettings.update', 'gitAi', {
    ...settings.value,
    model: 'chord-e2e-no-such-model',
  });
  const before = checkoutState(lanePath);
  const field = await openCommitField(page, item.name);
  await field.message.fill(TYPED);
  await readSettledLabel(field.generate);
  await runGenerate(field.generate);
  const failure = await readFailure(field.dialog);
  await page.screenshot({ path: report.shot('run-failure') });
  report.verdict(
    'a failed run shows the reason and the agent output',
    failure !== null && /Claude Code/.test(failure.reason) && failure.output !== null,
    JSON.stringify(failure)
  );
  report.verdict(
    'a failed run leaves the field exactly as typed',
    (await field.message.inputValue()) === TYPED,
    `"${await field.message.inputValue()}"`
  );
  report.verdict(
    'a failed run leaves the checkout as it was',
    checkoutState(lanePath) === before,
    'git state compared'
  );
  await account.instance.rpc('appSettings.update', 'gitAi', { ...settings.value, model: null });
  await page.keyboard.press('Escape');
}

async function checkCancel(page, item) {
  const field = await openCommitField(page, item.name);
  await field.message.fill(TYPED);
  await readSettledLabel(field.generate);
  await field.generate.click();
  await waitFor(
    async () => (await field.generate.innerText()).trim() === 'Cancel',
    10_000,
    'progress'
  );
  await page.screenshot({ path: report.shot('generating') });
  await field.generate.click();
  await waitFor(
    async () => (await field.generate.innerText()).trim() === 'Generate',
    30_000,
    'the run to stop'
  );
  report.verdict(
    'Cancel stops the run and leaves the field and no failure',
    (await field.message.inputValue()) === TYPED && (await readFailure(field.dialog)) === null,
    `"${await field.message.inputValue()}"`
  );
  await page.keyboard.press('Escape');
}

async function checkCommitGenerate(page, item, lanePath) {
  const before = checkoutState(lanePath);
  const sessionsBefore = savedGitAiSessions();
  const field = await openCommitField(page, item.name);
  await field.message.fill('');
  await readSettledLabel(field.generate);
  await runGenerate(field.generate);
  const message = (await field.message.inputValue()).trim();
  await page.screenshot({ path: report.shot('commit-generated') });
  report.verdict(
    'Generate fills the commit message from the staged change',
    message.length > 0 && (await readFailure(field.dialog)) === null,
    `"${message}"`
  );
  report.verdict(
    'the checkout is unchanged: the agent wrote and staged nothing',
    checkoutState(lanePath) === before,
    'HEAD, status, staged and unstaged diffs compared'
  );
  const sessionsAfter = savedGitAiSessions();
  report.verdict(
    'no Claude session was saved for the run',
    sessionsAfter.length === sessionsBefore.length,
    sessionsAfter.join(', ') || 'none'
  );
  await field.message.fill('');
  await page.keyboard.press('Escape');
}

async function checkCreatePr(account, page, item) {
  const agent = await openGitAiSettings(page);
  await page.getByRole('switch', { name: 'Create as draft' }).click();
  await waitFor(
    async () => (await account.call('gitAi.getSettings', { repoId: null })).value.prDefaults.draft,
    10_000,
    'the draft default to be stored'
  );
  await agent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: report.shot('settings-draft-default') });
  await page.getByText(item.name, { exact: true }).first().click();

  const form = await openCreatePrForm(page);
  const draft = form.dialog.getByRole('checkbox', { name: 'Create as draft' });
  await page.screenshot({ path: report.shot('create-pr-prefilled') });
  report.verdict(
    'Create PR opens with the repository template in the body (useTemplate)',
    form.body === TEMPLATE,
    JSON.stringify(form.body)
  );
  report.verdict(
    'Create PR opens with the draft default ticked',
    (await draft.getAttribute('aria-checked')) === 'true' || (await draft.isChecked()),
    `aria-checked ${await draft.getAttribute('aria-checked')}`
  );

  const generate = form.dialog.locator('button[data-git-ai-generate]');
  await readSettledLabel(generate);
  await runGenerate(generate);
  const title = await form.dialog.getByRole('textbox', { name: 'Title' }).inputValue();
  const body = await form.dialog.getByRole('textbox', { name: 'Description' }).inputValue();
  await page.screenshot({ path: report.shot('create-pr-generated') });
  report.verdict(
    'Generate fills the PR title from the lane',
    title.trim().length > 0 && title !== item.name && (await readFailure(form.dialog)) === null,
    `"${title}"`
  );
  report.verdict(
    'Generate fills the PR body, following the template',
    body.trim().length > 0 && body !== TEMPLATE && /Test plan/i.test(body),
    JSON.stringify(body.slice(0, 300))
  );
  await form.dialog.getByRole('button', { name: 'Cancel' }).click();
}

async function checkRepoOverride(account, page, alias, repoId) {
  await page.getByText(alias, { exact: true }).first().hover();
  await page.getByRole('button', { name: `${alias} options` }).click();
  await page.getByRole('menuitem', { name: 'Repository settings' }).click();
  const section = page.getByRole('region', { name: 'Git AI' });
  await section.waitFor({ timeout: 20_000 });
  await section.scrollIntoViewIfNeeded();
  const prField = section
    .getByText('Pull request instructions', { exact: true })
    // The whole field (header row, value or editor, and its buttons).
    .locator('xpath=ancestor::div[contains(@class,"flex-col") and contains(@class,"gap-2")][1]');
  report.verdict(
    'each Git AI field on the repository page shows where it comes from',
    /You|Default/.test(await prField.innerText()),
    (await prField.innerText()).slice(0, 160)
  );
  await prField.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Pull request instructions' }).fill('Name the ticket.');
  await prField.getByRole('button', { name: 'Save for me' }).click();
  await waitFor(
    async () =>
      (await account.call('gitAi.getSettings', { repoId })).layers['instructions.pr'] === 'justMe',
    10_000,
    'the just-me PR instructions to be stored'
  );
  const resolved = await account.call('gitAi.getSettings', { repoId });
  const youOnly = await account.call('gitAi.getSettings', { repoId: null });
  await page.screenshot({ path: report.shot('repo-override') });
  report.verdict(
    'the override sets only that field; the others still inherit',
    resolved.value.instructions.pr === 'Name the ticket.' &&
      resolved.layers.agent !== 'justMe' &&
      resolved.layers['prDefaults.draft'] !== 'justMe' &&
      resolved.value.prDefaults.draft === youOnly.value.prDefaults.draft,
    JSON.stringify(resolved.layers)
  );
  report.verdict(
    'the override applies to this repository only',
    youOnly.value.instructions.pr !== 'Name the ticket.' &&
      youOnly.layers['instructions.pr'] !== 'justMe',
    JSON.stringify(youOnly.layers)
  );
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const codexHome = mkdtempSync(join(tmpdir(), 'chord-git-ai-codex-home-'));
  const account = await launchAccount({
    seedProfile: 'chord-p1-smoke',
    label: 'git-ai',
    env: { CODEX_HOME: codexHome },
  });
  const { page } = account.instance;
  let workItem = null;
  try {
    await account.instance.rpc('appSettings.reset', 'gitAi');
    const alias = 'git-ai';
    const { repo } = await account.call('repos.create', { path: scratch.repo, alias });
    const created = await account.call('workItems.create', {
      name: `Chord e2e git ai ${Date.now()}`,
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
    shapeLane(lane.path);
    git(scratch.repo, 'remote', 'set-url', 'origin', OFFLINE_GITHUB_URL);
    git(
      scratch.repo,
      'config',
      `url.${pathToFileURL(scratch.origin).href}.pushInsteadOf`,
      OFFLINE_GITHUB_URL
    );
    const { shells } = await account.call('terminalShells.list');
    await account.call('agentSessions.createShellTerminal', {
      workItemId: workItem.id,
      shell: shells[0].id,
    });

    await checkSettingsAndNotSignedIn(account, page, workItem);
    await checkRunFailure(account, page, workItem, lane.path);
    await checkCancel(page, workItem);
    await checkCommitGenerate(page, workItem, lane.path);
    await checkCreatePr(account, page, workItem);
    await checkRepoOverride(account, page, alias, repo.id);
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: report.shot('failure') });
    throw error;
  } finally {
    await account.instance.rpc('appSettings.reset', 'gitAi');
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
    rmSync(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const failed = report.results.filter((r) => !r.ok);
  console.log(`\n${report.results.length - failed.length}/${report.results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
