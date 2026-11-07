/**
 * Live checks for Phase 3 slice 1 (devstation-arx.1), driven through the real
 * create dialog:
 *   - a GitHub issue URL is looked up in the owner/repo the URL names
 *     (cli/cli, not the scratch repository) and the dialog shows, before
 *     Create, `Work item: #2 <title>` and the branch; Create is disabled and
 *     Ctrl+Enter does nothing while the lookup is pending; the created item has
 *     exactly the shown name and branch, and its ticket (with title) was
 *     written with it;
 *   - a key whose provider isn't connected shows the reason and the key-only
 *     name, and Create waits for the lookup to settle;
 *   - a pasted PR URL whose repository is not a remote of the selected
 *     repository is refused in the preview, before Create: Create stays
 *     disabled and nothing is created (devstation-uoe);
 *   - once that repository is a remote, a same-repo PR shows "Checks out
 *     <branch> (PR #n)" and a fork PR "Checks out <branch> from <owner>/<repo>
 *     (PR #n)" (with a notice when the fork refuses maintainer pushes or was
 *     deleted); neither links a ticket. Create is not pressed there: it would
 *     fetch cli/cli. The fetch itself is covered against real repositories by
 *     src/main/core/work-items/pull-request-checkout.test.ts.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-arx1 node scripts/e2e/suites/create-ticket-naming.mjs
 *
 * Real targets: https://github.com/cli/cli/issues/2,
 * https://github.com/cli/cli/pull/14577 (same-repository) and
 * https://github.com/cli/cli/pull/14586 (from a fork). Titles, head branches
 * and fork details are read from GitHub's public API at run time, so an edit
 * upstream doesn't fail the suite. Needs GitHub connected in the seed profile,
 * and Jira or Linear not connected.
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder. Its work item is deleted in the app, and the suite waits until the
 * cloud no longer has it. Screenshots: <e2e out>/screenshots/create-ticket-naming-*.png.
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
  join(SHOTS, `create-ticket-naming-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const ISSUE_URL = 'https://github.com/cli/cli/issues/2';
const PR_URL = 'https://github.com/cli/cli/pull/14577';
const FORK_PR_URL = 'https://github.com/cli/cli/pull/14586';
const UNCONNECTED_KEY = 'ENG-42';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-ticket-naming-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'ticket-naming');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  git(repo, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# ticket naming\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'readme');
  git(repo, 'push', '-q', 'origin', 'main');
  return { root, repo };
}

async function readPublicGitHub(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub public API ${path} answered ${res.status}`);
  return res.json();
}

async function openDialog(page, alias) {
  await page.getByRole('button', { name: /^New work item/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Create work item', { exact: true }).waitFor({ timeout: 15_000 });
  await dialog.locator('button[aria-haspopup="menu"]').first().click();
  await dialog.getByRole('menu').getByText(alias, { exact: true }).click();
  return dialog;
}

const createButton = (dialog) => dialog.getByRole('button', { name: /^Create/ });
const nameField = (dialog) => dialog.getByPlaceholder(/ticket URL/);

async function listItems(account) {
  return (await account.call('workItems.getAll')).items;
}

async function checkGitHubIssue(account, page, alias, issue) {
  const before = await listItems(account);
  const dialog = await openDialog(page, alias);
  await nameField(dialog).fill(ISSUE_URL);
  // Before the debounce has even fired: the field is a ticket, so Create waits.
  const disabledAtOnce = await createButton(dialog).isDisabled();
  await nameField(dialog).press('Control+Enter');
  await page.screenshot({ path: shot('github-looking-up') });
  verdict(
    'Create is disabled while the GitHub lookup is pending',
    disabledAtOnce,
    `disabled right after typing: ${disabledAtOnce}`
  );

  const expectedName = `#2 ${issue.title}`;
  const nameLine = dialog.getByText(`Work item: ${expectedName}`, { exact: true });
  await nameLine.waitFor({ timeout: 30_000 });
  const branchLine = dialog.getByText(/^Branch: /);
  await branchLine.waitFor({ timeout: 15_000 });
  const shownBranch = (await branchLine.innerText()).replace(/^Branch:\s*/, '').trim();
  await page.screenshot({ path: shot('github-found') });
  verdict(
    'the issue is read from the owner/repo its URL names',
    await nameLine.isVisible(),
    `shown: Work item: ${expectedName}`
  );
  verdict(
    'the branch preview is built from key + title',
    shownBranch.includes('2-reimagine-how-the-app-determines-its-context-'),
    `shown: Branch: ${shownBranch}`
  );

  const afterCtrlEnter = await listItems(account);
  verdict(
    'Ctrl+Enter during the lookup created nothing',
    afterCtrlEnter.length === before.length,
    `${before.length} items before, ${afterCtrlEnter.length} after`
  );

  await createButton(dialog).click();
  await dialog.waitFor({ state: 'detached', timeout: 30_000 });
  let created = null;
  await waitFor(
    async () => {
      const items = await listItems(account);
      created = items.find((item) => !before.some((b) => b.id === item.id)) ?? null;
      return created !== null;
    },
    30_000,
    'the new work item'
  );
  verdict(
    'the created item has exactly the shown name',
    created.name === expectedName,
    `name: ${created.name}`
  );
  verdict(
    'the created item has exactly the shown branch',
    created.branchName === shownBranch,
    `branch: ${created.branchName}`
  );
  const { tickets } = await account.call('workItemTickets.getTickets', created.id);
  const ticket = tickets[0];
  verdict(
    'its ticket was written with it, title included',
    tickets.length === 1 &&
      ticket.ticketProvider === 'github' &&
      ticket.ticketId === '2' &&
      ticket.ticketTitle === issue.title,
    JSON.stringify(tickets.map((t) => [t.ticketProvider, t.ticketId, t.ticketTitle]))
  );
  return created;
}

async function checkUnconnectedKey(account, page, alias, providerLabel, text) {
  const before = await listItems(account);
  const dialog = await openDialog(page, alias);
  await nameField(dialog).fill(text);
  const disabledAtOnce = await createButton(dialog).isDisabled();
  const reason = dialog.getByText(/isn't connected/);
  await reason.waitFor({ timeout: 20_000 });
  const keyOnly = dialog.getByText(`Work item: ${UNCONNECTED_KEY}`, { exact: true });
  await page.screenshot({ path: shot('not-connected') });
  verdict(
    'Create waits for the lookup to settle',
    disabledAtOnce,
    `disabled right after typing: ${disabledAtOnce}`
  );
  verdict(
    'a failed lookup names its reason',
    new RegExp(providerLabel).test(await reason.innerText()),
    await reason.innerText()
  );
  verdict(
    'a failed lookup shows the key-only name',
    await keyOnly.isVisible(),
    `Work item: ${UNCONNECTED_KEY}`
  );
  verdict(
    'the key-only name can then be created',
    await createButton(dialog).isEnabled(),
    'Create enabled once the lookup failed'
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  verdict('nothing was created', (await listItems(account)).length === before.length, 'cancelled');
}

/**
 * What the dialog must say for a PR, from GitHub's own answer. The scratch
 * repository has none of cli/cli's branches, so the planned branch is the head
 * branch itself (no `<owner>/` collision rename).
 */
/** `remote`: the remote that is cli/cli — named in a same-repo label, as it is not the preferred remote. */
function describePullRequest(pull, remote) {
  const ref = pull.head.ref;
  if (pull.head.repo?.full_name === 'cli/cli') {
    return {
      kind: 'same-repo',
      label: `Checks out ${ref} from ${remote} (PR #${pull.number})`,
      notice: null,
    };
  }
  if (pull.head.repo === null) {
    return {
      kind: 'deleted-fork',
      label: `Checks out ${ref} from ${pull.head.user.login}'s deleted fork (PR #${pull.number})`,
      notice: /deleted/,
    };
  }
  return {
    kind: 'fork',
    label: `Checks out ${ref} from ${pull.head.repo.full_name} (PR #${pull.number})`,
    notice: pull.maintainer_can_modify ? null : /doesn't accept maintainer pushes/,
  };
}

/** A pasted PR whose repository is none of the selected repository's remotes. */
async function checkPullRequestNotARemote(account, page, alias, pull, url) {
  const kind = describePullRequest(pull, null).kind;
  const before = await listItems(account);
  const dialog = await openDialog(page, alias);
  await nameField(dialog).fill(url);
  const refusal = dialog.getByText(
    `Can't check out PR #${pull.number}: cli/cli isn't a remote of this repository`
  );
  await refusal.waitFor({ timeout: 30_000 });
  await page.screenshot({ path: shot(`pr-${kind}-not-a-remote`) });
  verdict(
    `a pasted ${kind} PR of a repository that isn't a remote is refused before Create`,
    true,
    await refusal.innerText()
  );
  verdict(
    `Create is disabled for that ${kind} PR`,
    await createButton(dialog).isDisabled(),
    'disabled'
  );
  await nameField(dialog).press('Control+Enter');
  verdict(
    `nothing was created for the refused ${kind} PR`,
    (await listItems(account)).length === before.length,
    `${before.length} items`
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
}

/** A pasted PR once its repository is a remote: the preview names what Create would check out. */
async function checkPullRequest(page, alias, pull, url, remote) {
  const expected = describePullRequest(pull, remote);
  const dialog = await openDialog(page, alias);
  await nameField(dialog).fill(url);
  const checkout = dialog.getByText(expected.label, { exact: true });
  await checkout.waitFor({ timeout: 30_000 });
  await page.screenshot({ path: shot(`pr-${expected.kind}-checks-out`) });
  verdict(`a pasted ${expected.kind} PR URL shows what it checks out`, true, expected.label);
  if (expected.notice) {
    const notice = dialog.getByText(expected.notice);
    verdict(
      `the ${expected.kind} PR says before Create that pushes can't reach it`,
      (await notice.count()) > 0,
      (await notice.count()) > 0 ? await notice.first().innerText() : 'no notice'
    );
  }
  verdict(
    `a ${expected.kind} PR is not offered as a ticket`,
    (await dialog.getByText(/^Links /).count()) === 0 &&
      (await dialog.getByText(/^Work item: /).count()) === 0,
    'no ticket line'
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
}

async function pickUnconnectedProvider(account) {
  const jira = await account.instance.rpc('issues.checkConnection', 'jira');
  if (!jira.connected) return { label: 'Jira', text: UNCONNECTED_KEY };
  const linear = await account.instance.rpc('issues.checkConnection', 'linear');
  if (!linear.connected) {
    return { label: 'Linear', text: `https://linear.app/chord-e2e/issue/${UNCONNECTED_KEY}` };
  }
  throw new Error('Jira and Linear are both connected in the seed profile; one must not be.');
}

async function main() {
  await assertServerHealthy();
  const issue = await readPublicGitHub('/repos/cli/cli/issues/2');
  const pull = await readPublicGitHub('/repos/cli/cli/pulls/14577');
  if (pull.head.repo?.full_name !== 'cli/cli') {
    throw new Error(`PR #14577's head is no longer in cli/cli (${pull.head.repo?.full_name})`);
  }
  const forkPull = await readPublicGitHub('/repos/cli/cli/pulls/14586');
  if (forkPull.head.repo?.full_name === 'cli/cli') {
    throw new Error('PR #14586 is no longer from a fork');
  }
  const scratch = createScratchRepo();
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'ticket-naming' });
  const { page } = account.instance;
  let workItem = null;
  try {
    const github = await account.instance.rpc('github.getStatus');
    if (!github?.authenticated) throw new Error('GitHub is not connected in the seed profile.');
    const unconnected = await pickUnconnectedProvider(account);

    const alias = `ticket-naming-${Date.now()}`;
    await account.call('repos.create', { path: scratch.repo, alias });

    workItem = await checkGitHubIssue(account, page, alias, issue);
    await checkUnconnectedKey(account, page, alias, unconnected.label, unconnected.text);
    await checkPullRequestNotARemote(account, page, alias, pull, PR_URL);
    await checkPullRequestNotARemote(account, page, alias, forkPull, FORK_PR_URL);
    // Named as a user adds it; never fetched, so the preview reads nothing of cli/cli.
    git(scratch.repo, 'remote', 'add', 'cli', 'https://github.com/cli/cli.git');
    await checkPullRequest(page, alias, pull, PR_URL, 'cli');
    await checkPullRequest(page, alias, forkPull, FORK_PR_URL, 'cli');

    await waitFor(
      async () => {
        const items = await listItems(account);
        const current = items.find((w) => w.id === workItem.id);
        return current?.provisionStatus === 'ready' || current?.provisionStatus === 'failed';
      },
      120_000,
      'the work item to finish provisioning'
    );
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
