/**
 * Live checks for PR per lane (plan 2026-09-26 P8, Phase 3 slice 4), driven
 * through the real UI:
 *   - the band and its Create PR follow the focused lane: the form opens on the
 *     lane's own branch (head) and its target_ref without the remote (base),
 *     with explicit Title and Description fields prefilled as before;
 *   - devstation-vzg: a repository with no GitHub remote offers no Create PR,
 *     and the band's menu says why;
 *   - GitHub mode only (below): each lane opens its own PR, the header lists
 *     both, a header chip focuses its lane, and promoting a lane moves the work
 *     item's PR, locally and in the cloud, to that lane's PR.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-pr-lanes node scripts/e2e/suites/pr-per-lane.mjs
 *
 * Default (offline) mode uses a scratch repository: a bare origin plus a clone.
 * After the vzg check its origin is renamed to a GitHub URL whose pushes still
 * go to the bare origin (`url.<bare>.pushInsteadOf`), so Chord sees a GitHub
 * remote and nothing reaches GitHub. No PR is created in this mode: creating a
 * PR, the header listing, Merge, and the promote mirror are NOT covered by it.
 *
 * GitHub mode: CHORD_E2E_GITHUB_REPO=<owner>/<name> names a disposable
 * repository the user chose, with a default branch, that this machine's git
 * can push to and the seed profile's GitHub connection can open PRs in
 * (`pr-per-lane-github.mjs`).
 *
 * The work item is deleted in the app, and the suite waits until the cloud no
 * longer has it. Screenshots: screenshots/e2e/pr-per-lane-NN-*.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkRealPrs, cloneGitHubRepo, closeRunPrs } from '../lib/pr-per-lane-github.mjs';
import { checkFormFollowsLane, checkNoRemoteRefusal, createReport } from '../lib/pr-per-lane-ui.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';

const report = createReport('pr-per-lane');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const GITHUB_REPO = process.env.CHORD_E2E_GITHUB_REPO?.trim() || null;
const RUN = `chord-e2e-${Date.now()}`;
const OFFLINE_GITHUB_URL = 'https://github.com/chord-e2e/pr-per-lane.git';

function configureAuthor(dir) {
  git(dir, 'config', 'user.email', 'e2e@chord.invalid');
  git(dir, 'config', 'user.name', 'Chord e2e');
}

/** Offline: bare origin with `main` and `release`; the clone Chord works in. */
function createScratchRepo(root) {
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'pr-lanes');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  configureAuthor(author);
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# pr per lane\n');
  git(author, 'add', 'README.md');
  git(author, 'commit', '-q', '-m', 'readme');
  git(author, 'push', '-q', 'origin', 'main');
  git(author, 'push', '-q', 'origin', 'main:release');
  git(root, 'clone', '-q', origin, repo);
  configureAuthor(repo);
  return { repo, origin, target: 'release', defaultBranch: 'main' };
}

function commitInLane(lanePath, file) {
  writeFileSync(join(lanePath, file), `${file} written by the e2e\n`);
  git(lanePath, 'add', file);
  git(lanePath, 'commit', '-q', '-m', `Add ${file}`);
}

/** A work item whose primary targets `<target>` and a secondary lane targeting the default. */
async function createTwoLaneItem(account, scratch) {
  const { repo } = await account.call('repos.create', { path: scratch.repo, alias: 'pr-lanes' });
  const created = await account.call('workItems.create', {
    name: `Chord e2e PR per lane ${Date.now()}`,
    repoId: repo.id,
    baseRef: `origin/${scratch.target}`,
  });
  let workItem = created.item;
  await waitFor(
    async () => {
      const { items } = await account.call('workItems.getAll');
      workItem = items.find((w) => w.id === workItem.id);
      return workItem?.provisionStatus === 'ready';
    },
    120_000,
    'the work item to be checked out'
  );
  const before = await account.call('worktrees.list', workItem.id);
  const primary = before.worktrees.find((w) => w.isPrimary);
  // Based explicitly on the primary's branch, so its target is the repository default.
  await account.call('worktrees.create', {
    workItemId: workItem.id,
    title: 'api',
    baseBranch: primary.branchName,
  });
  const after = await account.call('worktrees.list', workItem.id);
  const secondary = after.worktrees.find((w) => !w.isPrimary);
  report.verdict(
    'the two lanes have different targets',
    primary.targetRef === `origin/${scratch.target}` &&
      secondary.targetRef === `origin/${scratch.defaultBranch}`,
    `primary ${primary.targetRef}, secondary ${secondary.targetRef}`
  );
  commitInLane(primary.path, 'primary.txt');
  commitInLane(secondary.path, 'secondary.txt');

  // A session in each lane: focusing a lane means focusing something running in it.
  const { shells } = await account.call('terminalShells.list');
  await account.call('agentSessions.createShellTerminal', {
    workItemId: workItem.id,
    shell: shells[0].id,
  });
  await account.call('agentSessions.createShellTerminal', {
    workItemId: workItem.id,
    shell: shells[0].id,
    worktreeId: secondary.id,
  });
  return { workItem, primary, secondary };
}

async function checkOffline(page, scratch, { workItem, primary, secondary }) {
  await checkNoRemoteRefusal(page, report, primary.branchName);
  git(scratch.repo, 'remote', 'set-url', 'origin', OFFLINE_GITHUB_URL);
  git(
    scratch.repo,
    'config',
    `url.${pathToFileURL(scratch.origin).href}.pushInsteadOf`,
    OFFLINE_GITHUB_URL
  );
  for (const [label, lane, base] of [
    ['secondary', secondary, scratch.defaultBranch],
    ['primary', primary, scratch.target],
  ]) {
    const form = await checkFormFollowsLane(page, report, {
      label,
      branch: lane.branchName,
      expectedBase: base,
      itemName: workItem.name,
    });
    await form.dialog.getByRole('button', { name: 'Cancel' }).click();
  }
  console.log('NOT COVERED offline: creating a PR, the header listing, Merge, promote mirror.');
}

async function main() {
  await assertServerHealthy();
  const root = mkdtempSync(join(tmpdir(), 'chord-pr-lanes-'));
  const scratch = GITHUB_REPO ? cloneGitHubRepo(root, GITHUB_REPO, RUN) : createScratchRepo(root);
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'pr-lanes' });
  const { page } = account.instance;
  let lanes = null;
  /** Every PR this run opened, recorded as each one syncs. */
  const opened = [];
  try {
    lanes = await createTwoLaneItem(account, scratch);
    await page.getByText(lanes.workItem.name, { exact: true }).first().click();
    if (GITHUB_REPO) {
      await checkRealPrs(account, page, report, { ...lanes, scratch, run: RUN, opened });
    } else {
      await checkOffline(page, scratch, lanes);
    }
  } catch (error) {
    await page.screenshot({ path: report.shot('failure') });
    throw error;
  } finally {
    if (GITHUB_REPO) {
      const laneBranches = lanes ? [lanes.primary.branchName, lanes.secondary.branchName] : [];
      await closeRunPrs(account, report, {
        repo: scratch.repo,
        branches: [scratch.target, ...laneBranches],
        prs: opened,
        repositoryUrl: `https://github.com/${GITHUB_REPO}`,
      });
    }
    if (lanes) {
      await account.call('workItems.remove', lanes.workItem.id);
      await waitFor(
        async () => (await account.api('GET', `/work-items/${lanes.workItem.id}`)).status === 404,
        60_000,
        'the cloud to drop the run’s work item'
      );
    }
    await account.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const failed = report.results.filter((r) => !r.ok);
  console.log(`\n${report.results.length - failed.length}/${report.results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
