/**
 * GitHub mode of `pr-per-lane.mjs` (CHORD_E2E_GITHUB_REPO=<owner>/<name>):
 * real PRs from two lanes of one work item, in a disposable repository the
 * user named. Only branches under this run's `chord-e2e-<run>/` prefix and the
 * lanes' own branches are pushed, and all of them are deleted at the end.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { checkFormFollowsLane } from './pr-per-lane-ui.mjs';
import { waitFor } from './sharing/sharing-accounts.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

/** A clone of the user's disposable repository, plus this run's target branch on GitHub. */
export function cloneGitHubRepo(root, githubRepo, run) {
  const repo = join(root, 'pr-lanes');
  git(root, 'clone', '-q', `https://github.com/${githubRepo}.git`, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  const defaultBranch = git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(
    /^origin\//,
    ''
  );
  const target = `${run}/target`;
  git(repo, 'push', '-q', 'origin', `HEAD:refs/heads/${target}`);
  git(repo, 'fetch', '-q', 'origin', target);
  return { repo, origin: null, target, defaultBranch };
}

/**
 * Cleanup: deletes only this run's branches — its target and its two lanes'
 * branches, all named for this run — and confirms on GitHub that every PR the
 * run opened is closed (deleting a PR's head branch closes it). A branch that
 * was never pushed is reported, not treated as a failure.
 */
export async function closeRunPrs(account, report, { repo, branches, prs, repositoryUrl }) {
  for (const branch of branches) {
    try {
      git(repo, 'push', '-q', 'origin', '--delete', branch);
    } catch (error) {
      console.log(`cleanup: branch ${branch} was not on GitHub (${String(error).split('\n')[0]})`);
    }
  }
  for (const pr of prs) {
    let status = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && status !== 'closed') {
      const refreshed = await account.call(
        'pullRequests.refreshPullRequest',
        repositoryUrl,
        pr.number
      );
      status = refreshed.pr?.status ?? null;
      if (status !== 'closed') await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    report.verdict(
      `cleanup: PR #${pr.number} is closed on GitHub`,
      status === 'closed',
      `status ${status}`
    );
  }
}

/**
 * Submits the form and waits until the lane's PR is synced into Chord. Every
 * PR is recorded in `opened` as soon as it exists, so cleanup closes it even
 * when a later check throws.
 */
async function submitLanePr(account, opened, form, workItemId, worktreeId, title) {
  await form.dialog.getByRole('textbox', { name: 'Title' }).fill(title);
  await form.dialog.getByRole('button', { name: 'Create pull request' }).click();
  let pr = null;
  await waitFor(
    async () => {
      const { lanes } = await account.call('pullRequests.getLanePullRequests', workItemId);
      pr = lanes.find((lane) => lane.worktreeId === worktreeId)?.pr ?? null;
      return pr !== null;
    },
    120_000,
    `the PR for lane ${worktreeId} to sync`
  );
  opened.push(pr);
  return pr;
}

async function openLanePr(
  account,
  page,
  report,
  { workItem, lane, label, expectedBase, run, opened }
) {
  const form = await checkFormFollowsLane(page, report, {
    label,
    branch: lane.branchName,
    expectedBase,
    itemName: workItem.name,
  });
  const pr = await submitLanePr(account, opened, form, workItem.id, lane.id, `${run} ${label}`);
  report.verdict(
    `${label} lane opened its own PR against its target`,
    pr.headRefName === lane.branchName && pr.baseRefName === expectedBase,
    `#${pr.number} ${pr.headRefName} → ${pr.baseRefName}`
  );
  return pr;
}

export async function checkRealPrs(account, page, report, ctx) {
  const { workItem, primary, secondary, scratch, run, opened } = ctx;
  const secondaryPr = await openLanePr(account, page, report, {
    workItem,
    lane: secondary,
    label: 'secondary',
    expectedBase: scratch.defaultBranch,
    run,
    opened,
  });
  // The secondary's PR does not block the primary's.
  const primaryPr = await openLanePr(account, page, report, {
    workItem,
    lane: primary,
    label: 'primary',
    expectedBase: scratch.target,
    run,
    opened,
  });

  const chip = (n) => page.getByRole('button', { name: new RegExp(`PR #${n}\\b`) });
  await chip(secondaryPr.number).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: report.shot('header-both-prs') });
  report.verdict(
    'header lists every lane’s PR',
    (await chip(primaryPr.number).isVisible()) && (await chip(secondaryPr.number).isVisible()),
    `#${primaryPr.number} and #${secondaryPr.number}`
  );

  await chip(secondaryPr.number).click();
  const bandPr = page.getByRole('button', { name: `#${secondaryPr.number}`, exact: true });
  await bandPr.waitFor({ timeout: 15_000 });
  await page.screenshot({ path: report.shot('chip-focused-secondary') });
  report.verdict(
    'a header chip focuses its lane: the band shows that lane’s PR',
    await bandPr.isVisible(),
    `band #${secondaryPr.number}`
  );

  await account.call('worktrees.promoteToPrimary', secondary.id);
  const { items } = await account.call('workItems.getAll');
  const promoted = items.find((item) => item.id === workItem.id);
  report.verdict(
    'promote: the work item’s PR follows the new primary',
    promoted.prNumber === secondaryPr.number && promoted.prUrl === secondaryPr.url,
    `pr_number ${promoted.prNumber}, pr_url ${promoted.prUrl}`
  );

  // Polled rather than waitFor: a cloud that never follows is a FAIL verdict
  // with what it held, not an exception that skips the cleanup's report.
  let cloudPr = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && cloudPr !== secondaryPr.number) {
    cloudPr = (await account.api('GET', `/work-items/${workItem.id}`)).body?.pr_number ?? null;
    if (cloudPr !== secondaryPr.number) await page.waitForTimeout(2_000);
  }
  report.verdict(
    'promote: the cloud mirror follows',
    cloudPr === secondaryPr.number,
    `cloud pr_number ${cloudPr}`
  );
}
