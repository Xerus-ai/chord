/**
 * Live checks for Phase 3 slice 2 (devstation-arx.2), Create from… in the real
 * create dialog:
 *   - Branches: the main checkout's branch is listed "checked out in <repo>",
 *     a branch another lane has "in work item <name>", a remote-only branch
 *     "from origin". Picking the lane's branch shows why it can't be reused and
 *     exactly one action, "Branch off <branch> instead"; choosing it creates a
 *     lane whose base (target_ref) is that branch, with a branch of its own.
 *     Picking a free branch creates a checkout of that branch. A branch only
 *     a second remote (`upstream`) has is listed `upstream/feature-up` and
 *     checks out as `feature-up` tracking upstream.
 *   - A branch taken after it was picked (checked out by hand) is refused by
 *     Create inline, with the same action, the dialog open, nothing created.
 *   - Pull requests: the scratch repository (its origin is a local bare repo)
 *     shows its no-GitHub-remote empty state; a repository whose `upstream` is
 *     https://github.com/cli/cli lists cli/cli's open PRs, and a pick shows
 *     what it checks out, as a pasted PR URL does.
 *   - Issues: for the cli/cli-backed repository GitHub lists cli/cli's open
 *     issues (live, the seed profile's GitHub connection); picking the first
 *     creates an item named `#<n> <title>` with its ticket written with it.
 *     The scratch repository's tab says GitHub has no issues for it.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-arx2 node scripts/e2e/suites/create-from-picker.mjs
 *
 * Needs GitHub connected in the seed profile `chord-p1-smoke`. Scratch
 * repositories (two bare remotes, two clones) live under the OS temp folder.
 * Every work item the run creates is deleted in the app and the suite waits
 * until the cloud no longer has it. Screenshots:
 * <e2e out>/screenshots/create-from-picker-NN-*.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `create-from-picker-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const GITHUB_UPSTREAM = 'https://github.com/cli/cli.git';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

/** origin (bare): main, feat/remote-only. `repo`: main + local feat/held, feat/free, feat/race. */
function createScratchRepos() {
  const root = mkdtempSync(join(tmpdir(), 'chord-create-from-'));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'create-from');
  const githubRepo = join(root, 'create-from-gh');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# create from\n');
  git(author, 'add', 'README.md');
  git(author, 'commit', '-q', '-m', 'readme');
  git(author, 'push', '-q', 'origin', 'main');
  git(author, 'checkout', '-q', '-b', 'feat/remote-only');
  git(author, 'commit', '-q', '--allow-empty', '-m', 'remote only');
  git(author, 'push', '-q', 'origin', 'feat/remote-only');
  for (const dir of [repo, githubRepo]) {
    git(root, 'clone', '-q', origin, dir);
    git(dir, 'config', 'user.email', 'e2e@chord.invalid');
    git(dir, 'config', 'user.name', 'Chord e2e');
  }
  for (const branch of ['feat/held', 'feat/free', 'feat/race']) git(repo, 'branch', branch);
  // A second remote, with a branch origin doesn't have.
  const upstream = join(root, 'upstream.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', upstream);
  git(author, 'remote', 'add', 'upstream', upstream);
  git(author, 'checkout', '-q', '-b', 'feature-up', 'main');
  git(author, 'commit', '-q', '--allow-empty', '-m', 'upstream only');
  git(author, 'push', '-q', 'upstream', 'feature-up');
  git(repo, 'remote', 'add', 'upstream', upstream);
  git(repo, 'fetch', '-q', 'upstream');
  // Never fetched: it only names the GitHub repository PRs and issues come from.
  git(githubRepo, 'remote', 'add', 'upstream', GITHUB_UPSTREAM);
  return { root, repo, githubRepo };
}

async function openDialog(page, alias) {
  await page.getByRole('button', { name: /^New work item/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Create work item', { exact: true }).waitFor({ timeout: 15_000 });
  await dialog.locator('button[aria-haspopup="menu"]').first().click();
  await dialog.getByRole('menu').getByText(alias, { exact: true }).click();
  return dialog;
}

async function openTab(dialog, tab) {
  if ((await dialog.getByRole('tablist').count()) === 0) {
    await dialog.getByRole('button', { name: 'Create from…' }).click();
  }
  await dialog.getByRole('tab', { name: tab }).click();
  return dialog.getByRole('tabpanel');
}

const createButton = (dialog) => dialog.getByRole('button', { name: /^Create/ });
const option = (panel, text) => panel.getByRole('option').filter({ hasText: text }).first();
const listItems = async (account) => (await account.call('workItems.getAll')).items;

async function cancel(dialog) {
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
}

/** Creates and waits for the one new item; returns it once provisioning settled. */
async function createAndWait(account, dialog, before) {
  await createButton(dialog).click();
  await dialog.waitFor({ state: 'detached', timeout: 30_000 });
  let created = null;
  await waitFor(
    async () => {
      const items = await listItems(account);
      created = items.find((item) => !before.some((b) => b.id === item.id)) ?? null;
      return created?.provisionStatus === 'ready' || created?.provisionStatus === 'failed';
    },
    120_000,
    'the new work item to finish provisioning'
  );
  return created;
}

async function primaryLane(account, workItemId) {
  const { worktrees } = await account.call('worktrees.list', workItemId);
  return worktrees.find((lane) => lane.isPrimary);
}

async function checkBranchesTab(account, page, alias, scratch, holderItem, created) {
  const dialog = await openDialog(page, alias);
  const panel = await openTab(dialog, 'Branches');
  await option(panel, 'feat/held').waitFor({ timeout: 20_000 });
  await page.screenshot({ path: shot('branches-holders') });
  const mainRow = await option(panel, /^\s*main/).innerText();
  verdict(
    'the main checkout’s branch is listed with its folder',
    mainRow.includes('checked out in') && mainRow.includes(basename(scratch.repo)),
    mainRow.replace(/\s+/g, ' ')
  );
  const heldRow = await option(panel, 'feat/held').innerText();
  verdict(
    'a lane’s branch is listed with its work item',
    heldRow.includes(`in work item ${holderItem.name}`),
    heldRow.replace(/\s+/g, ' ')
  );
  const remoteRow = await option(panel, 'feat/remote-only').innerText();
  verdict('a remote-only branch is listed from origin', /origin/.test(remoteRow), remoteRow);

  await panel.getByPlaceholder('Search branches').fill('free');
  await page.screenshot({ path: shot('branches-search') });
  verdict(
    'search narrows the branches',
    (await panel.getByRole('option').count()) === 1 &&
      (await option(panel, 'feat/free').count()) === 1,
    `${await panel.getByRole('option').count()} row(s) for "free"`
  );
  await panel.getByPlaceholder('Search branches').fill('');

  await option(panel, 'feat/held').click();
  const branchOff = dialog.getByRole('button', { name: 'Branch off feat/held instead' });
  await branchOff.waitFor({ timeout: 15_000 });
  const reason = await dialog.getByText(/feat\/held is already checked out/).innerText();
  await page.screenshot({ path: shot('held-reason') });
  verdict('picking a held branch names why', reason.includes(holderItem.name), reason);
  verdict(
    'the held branch offers exactly one action and nothing to create',
    (await dialog.getByRole('button', { name: /instead$/ }).count()) === 1 &&
      (await createButton(dialog).isDisabled()),
    'one "instead" button; Create disabled'
  );

  const before = await listItems(account);
  await branchOff.click();
  await dialog.getByText('New branch from feat/held', { exact: true }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: shot('branch-off-chosen') });
  const branchedOff = await createAndWait(account, dialog, before);
  created.push(branchedOff);
  const offLane = await primaryLane(account, branchedOff.id);
  verdict(
    'Branch off creates a lane based on that branch, on a branch of its own',
    branchedOff.provisionStatus === 'ready' &&
      offLane.targetRef === 'feat/held' &&
      offLane.branchName !== 'feat/held' &&
      !/-1$/.test(offLane.branchName ?? ''),
    `status ${branchedOff.provisionStatus}, target ${offLane.targetRef}, branch ${offLane.branchName}`
  );

  const beforeFree = await listItems(account);
  const freeDialog = await openDialog(page, alias);
  const freePanel = await openTab(freeDialog, 'Branches');
  await option(freePanel, 'feat/free').click();
  await freeDialog.getByText('Checks out feat/free', { exact: true }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: shot('free-branch-picked') });
  const checkout = await createAndWait(account, freeDialog, beforeFree);
  created.push(checkout);
  const freeLane = await primaryLane(account, checkout.id);
  verdict(
    'picking a free branch creates a checkout of it',
    checkout.provisionStatus === 'ready' &&
      freeLane.branchName === 'feat/free' &&
      freeLane.forkSource === null,
    `status ${checkout.provisionStatus}, branch ${freeLane.branchName}`
  );
}

async function checkOtherRemoteBranch(account, page, alias, scratch, created) {
  const before = await listItems(account);
  const dialog = await openDialog(page, alias);
  const panel = await openTab(dialog, 'Branches');
  await option(panel, 'upstream/feature-up').click();
  await dialog
    .getByText('Checks out feature-up from upstream', { exact: true })
    .waitFor({ timeout: 15_000 });
  await page.screenshot({ path: shot('other-remote-picked') });
  const item = await createAndWait(account, dialog, before);
  created.push(item);
  const lane = await primaryLane(account, item.id);
  verdict(
    'another remote’s branch checks out as a local branch tracking it',
    item.provisionStatus === 'ready' &&
      lane.branchName === 'feature-up' &&
      git(scratch.repo, 'config', '--get', 'branch.feature-up.remote') === 'upstream',
    `status ${item.provisionStatus}, branch ${lane.branchName}`
  );
}

async function checkTakenAfterPick(account, page, alias, scratch) {
  const before = await listItems(account);
  const dialog = await openDialog(page, alias);
  const panel = await openTab(dialog, 'Branches');
  await option(panel, 'feat/race').click();
  await dialog.getByText('Checks out feat/race', { exact: true }).waitFor({ timeout: 15_000 });
  const byHand = join(scratch.root, 'by-hand-race');
  git(scratch.repo, 'worktree', 'add', '-q', byHand, 'feat/race');
  await createButton(dialog).click();
  const alert = dialog.getByRole('alert');
  await alert.waitFor({ timeout: 30_000 });
  const alertText = await alert.innerText();
  await page.screenshot({ path: shot('taken-after-pick') });
  verdict(
    'a branch taken after the pick is refused inline, naming where',
    alertText.includes('feat/race') && alertText.includes(basename(byHand)),
    alertText.replace(/\s+/g, ' ')
  );
  verdict(
    'the refusal offers Branch off instead',
    await dialog.getByRole('button', { name: 'Branch off feat/race instead' }).isVisible(),
    'button visible'
  );
  verdict('the dialog stays open', await dialog.isVisible(), 'dialog visible');
  verdict(
    'nothing was created for the refused pick',
    (await listItems(account)).length === before.length,
    `${before.length} items`
  );
  await cancel(dialog);
}

async function checkScratchEmptyStates(page, alias) {
  const dialog = await openDialog(page, alias);
  const prPanel = await openTab(dialog, 'Pull requests');
  const empty = prPanel.getByText(/no GitHub remote/);
  await empty.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: shot('prs-empty-state') });
  verdict(
    'the PRs tab says the scratch repository has no GitHub remote',
    (await prPanel.getByRole('option').count()) === 0,
    await empty.innerText()
  );
  const issuesPanel = await openTab(dialog, 'Issues');
  const notice = issuesPanel.getByText(/no GitHub remote/);
  await notice.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: shot('issues-no-github-remote') });
  verdict('the Issues tab says GitHub has no issues for it', true, await notice.innerText());
  await cancel(dialog);
}

/** As `use-create-from-sources.ts` asks GitHub for a search. */
const ISSUE_SEARCH_LIMIT = 20;

/** A GitHub issue's row by its exact `#<n>`: `#14` must not match `#14386`. */
const issueRow = (panel, key) =>
  panel.getByRole('option').filter({ hasText: new RegExp(`^\\s*${key}(?!\\d)`) });

/** The `#<n>` of each GitHub issue row, in order (other trackers' rows have keys, not numbers). */
async function githubIssueKeys(panel) {
  const texts = await panel.getByRole('option').allInnerTexts();
  return texts.map((text) => /^#\d+/.exec(text.trim())?.[0]).filter(Boolean);
}

async function checkGitHubRepository(account, page, alias, githubRepoId, created) {
  const prDialog = await openDialog(page, alias);
  const prPanel = await openTab(prDialog, 'Pull requests');
  const firstPull = prPanel.getByRole('option').first();
  await firstPull.waitFor({ timeout: 30_000 });
  const pullText = (await firstPull.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: shot('prs-cli-cli') });
  verdict('the PRs tab lists cli/cli’s open pull requests', /#\d+/.test(pullText), pullText);
  await firstPull.click();
  const label = prDialog.getByText(/^Checks out .+ \(PR #\d+\)$/);
  await label.waitFor({ timeout: 30_000 });
  await page.screenshot({ path: shot('pr-picked') });
  verdict('a PR pick shows what it checks out', true, await label.innerText());
  await cancel(prDialog);

  const before = await listItems(account);
  const dialog = await openDialog(page, alias);
  const panel = await openTab(dialog, 'Issues');
  const firstIssue = panel.getByRole('option').first();
  await firstIssue.waitFor({ timeout: 30_000 });
  const [, number, title] = /#(\d+)\s+(.+)/.exec(await firstIssue.innerText()) ?? [];
  await page.screenshot({ path: shot('issues-cli-cli') });
  verdict(
    'the Issues tab lists cli/cli’s open issues',
    Boolean(number && title),
    `#${number} ${title}`
  );
  const term = title.trim().split(/\s+/).slice(0, 4).join(' ');
  // Waiting for a row both lists have proves nothing, and the unfiltered rows
  // go as soon as the search starts loading. GitHub's answer is read the way
  // the tab asks for it; the check waits for an unfiltered row that answer
  // doesn't have to go, and then for the answer's first row to be shown.
  const unfiltered = await githubIssueKeys(panel);
  const { repositoryUrl } = await account.call('createFrom.readGitHubRepository', githubRepoId);
  const searched = await account.instance.rpc('issues.searchIssues', 'github', {
    repositoryUrl,
    searchTerm: term,
    limit: ISSUE_SEARCH_LIMIT,
  });
  if (!searched?.success) throw new Error(`issues.searchIssues: ${JSON.stringify(searched)}`);
  const expected = searched.issues.map((issue) => issue.identifier);
  const replaced = unfiltered.find((key) => !expected.includes(key));
  if (!replaced) {
    throw new Error(`"${term}" finds every unfiltered row, so the search can't be told apart`);
  }
  await panel.getByPlaceholder('Search issues').fill(term);
  await issueRow(panel, replaced).waitFor({ state: 'detached', timeout: 30_000 });
  await issueRow(panel, expected[0]).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: shot('issues-search') });
  const shown = await githubIssueKeys(panel);
  verdict(
    'search replaces the list with GitHub’s search result',
    JSON.stringify(shown) === JSON.stringify(expected),
    `searched "${term}": shows ${shown.join(' ')}; GitHub has ${expected.join(' ')}; ${replaced} gone`
  );
  verdict('search finds the issue', shown.includes(`#${number}`), `#${number}`);
  await option(panel, `#${number}`).click();
  const expectedName = `#${number} ${title.trim()}`;
  await dialog
    .getByText(`Work item: ${expectedName}`, { exact: true })
    .waitFor({ timeout: 15_000 });
  await page.screenshot({ path: shot('issue-picked') });
  const item = await createAndWait(account, dialog, before);
  created.push(item);
  verdict('the issue’s item is named from key and title', item.name === expectedName, item.name);
  const { tickets } = await account.call('workItemTickets.getTickets', item.id);
  verdict(
    'its ticket was written with it',
    tickets.length === 1 &&
      tickets[0].ticketProvider === 'github' &&
      tickets[0].ticketId === number,
    JSON.stringify(tickets.map((t) => [t.ticketProvider, t.ticketId, t.ticketTitle]))
  );
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepos();
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'create-from' });
  const { page } = account.instance;
  const created = [];
  try {
    const github = await account.instance.rpc('github.getStatus');
    if (!github?.authenticated) throw new Error('GitHub is not connected in the seed profile.');
    const stamp = Date.now();
    const alias = `create-from-${stamp}`;
    const githubAlias = `create-from-gh-${stamp}`;
    const { repo } = await account.call('repos.create', { path: scratch.repo, alias });
    const { repo: githubRepo } = await account.call('repos.create', {
      path: scratch.githubRepo,
      alias: githubAlias,
    });

    // Arrangement, not the check: a lane already holding feat/held.
    const holder = (
      await account.call('workItems.create', {
        name: `Holds feat/held ${stamp}`,
        repoId: repo.id,
        existingBranch: 'feat/held',
      })
    ).item;
    created.push(holder);
    await waitFor(
      async () =>
        (await listItems(account)).find((w) => w.id === holder.id)?.provisionStatus === 'ready',
      120_000,
      'the holding lane to be checked out'
    );
    verdict(
      'arranged: feat/held is checked out in a lane',
      git(scratch.repo, 'worktree', 'list').includes('[feat/held]'),
      resolve(scratch.repo)
    );

    await checkBranchesTab(account, page, alias, scratch, holder, created);
    await checkOtherRemoteBranch(account, page, alias, scratch, created);
    await checkTakenAfterPick(account, page, alias, scratch);
    await checkScratchEmptyStates(page, alias);
    await checkGitHubRepository(account, page, githubAlias, githubRepo.id, created);
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    for (const item of created) {
      await account.call('workItems.remove', item.id);
      await waitFor(
        async () => (await account.api('GET', `/work-items/${item.id}`)).status === 404,
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
