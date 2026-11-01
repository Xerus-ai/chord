/**
 * Phase 1 checks 1–6, on a repository with no `.chord.json`: what typing in
 * the create dialog makes, the refusals that keep the dialog open with nothing
 * created, offline create, deleting a failed item, and the fork point.
 */
import { existsSync, renameSync } from 'node:fs';
import { waitFor } from '../sharing/sharing-accounts.mjs';
import {
  createButton,
  git,
  listItemIds,
  nameField,
  openCreateDialog,
  primaryLane,
  pushRemoteOnly,
  readForkColumns,
  rootState,
  tryCreate,
  waitForNewItem,
  waitForProvision,
} from './phase1-support.mjs';

/** Checks 1 and 6: typed `main` is a name, and the lane forks from the freshly fetched origin/HEAD. */
export async function checkTypedMainForksFetchedBase(ctx, repo) {
  const { account, page, r } = ctx;
  const remoteSha = pushRemoteOnly(repo, 'remote-only.txt');
  const staleOrigin = git(repo.root, 'rev-parse', 'origin/main');
  const before = await listItemIds(account);
  const dialog = await openCreateDialog(page, repo.alias);
  await nameField(dialog).fill('main');
  await waitFor(() => createButton(dialog).isEnabled(), 15_000, 'Create to be enabled');
  const reuseHints = await dialog.getByText(/Reuses/).count();
  await page.screenshot({ path: r.shot('typed-main') });
  await createButton(dialog).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  const item = await waitForNewItem(account, before, 'the item named main');
  ctx.created.push(item.id);
  await waitForProvision(account, item.id, 'ready');
  const lane = await primaryLane(account, item.id);
  const fork = readForkColumns(account.instance.profileDir, lane.id);
  const laneHead = git(lane.path, 'rev-parse', 'HEAD');
  // Create opened the item.
  await page.getByText(lane.branchName).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: r.shot('main-lane-ready') });
  r.check(
    'Typing main creates a new lane named main-…, and nothing claims to reuse a branch',
    item.name === 'main' &&
      lane.branchName !== 'main' &&
      /main-/.test(lane.branchName) &&
      reuseHints === 0 &&
      git(repo.root, 'branch', '--show-current') === 'main',
    `item "${item.name}", branch ${lane.branchName}, "Reuses" hints ${reuseHints}`
  );
  r.check(
    'A new lane forks from the fetched origin/HEAD and records fork_sha',
    staleOrigin !== remoteSha &&
      fork.forkSha === remoteSha &&
      laneHead === remoteSha &&
      fork.targetRef === 'origin/main' &&
      fork.forkSource === 'fetched',
    `root's origin/main before ${staleOrigin.slice(0, 7)}, remote ${remoteSha.slice(0, 7)}; ` +
      `fork_sha ${fork.forkSha?.slice(0, 7)}, lane HEAD ${laneHead.slice(0, 7)}, ` +
      `target ${fork.targetRef}, source ${fork.forkSource}`
  );
  return lane;
}

/** Check 2: a branch checked out in the root or in another lane is refused, typed, before anything exists. */
export async function checkCheckedOutBranchRefused(ctx, repo, otherLane) {
  const { account, r } = ctx;
  const before = await listItemIds(account);
  const inRoot = await tryCreate(account, {
    name: 'Phase 1 root branch',
    repoId: repo.repoId,
    existingBranch: 'main',
  });
  const inLane = await tryCreate(account, {
    name: 'Phase 1 lane branch',
    repoId: repo.repoId,
    existingBranch: otherLane.branchName,
  });
  const after = await listItemIds(account);
  const samePath = (a, b) =>
    a?.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
  r.check(
    'A branch checked out in the root or another lane is refused with a typed error, nothing created',
    inRoot.success === false &&
      inRoot.error?.type === 'branch_checked_out' &&
      samePath(inRoot.error.path, repo.root) &&
      inLane.success === false &&
      inLane.error?.type === 'branch_checked_out' &&
      samePath(inLane.error.path, otherLane.path) &&
      after.length === before.length,
    `root: ${JSON.stringify(inRoot.error)}; lane: ${JSON.stringify(inLane.error)}; ` +
      `items ${before.length} → ${after.length}`
  );
}

/** Check 3: a base or branch that does not exist is a typed error; in the dialog, the dialog stays open. */
export async function checkMissingBaseRefused(ctx, repo) {
  const { account, page, r } = ctx;
  const before = await listItemIds(account);
  const dialog = await openCreateDialog(page, repo.alias);
  await nameField(dialog).fill('Phase 1 missing base');
  await dialog.getByText('Advanced', { exact: true }).click();
  await dialog.getByPlaceholder(/Defaults to the remote's default branch/).fill('no-such-branch');
  await waitFor(() => createButton(dialog).isEnabled(), 15_000, 'Create to be enabled');
  await createButton(dialog).click();
  const alert = dialog.getByRole('alert');
  await alert.waitFor({ timeout: 60_000 });
  const alertText = await alert.innerText();
  await page.screenshot({ path: r.shot('missing-base') });
  const stillOpen = await dialog.isVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  const branch = await tryCreate(account, {
    name: 'Phase 1 missing branch',
    repoId: repo.repoId,
    existingBranch: 'no-such-branch',
  });
  const after = await listItemIds(account);
  r.check(
    'A base that does not exist is refused in the dialog, which stays open; nothing created',
    /no-such-branch/.test(alertText) && /not found/.test(alertText) && stillOpen,
    alertText
  );
  r.check(
    'A branch that does not exist is refused with a typed error; nothing created',
    branch.success === false &&
      branch.error?.type === 'branch_not_found' &&
      after.length === before.length,
    `${JSON.stringify(branch.error)}; items ${before.length} → ${after.length}`
  );
}

/**
 * Checks 4 and 5, with origin unreachable: create offers the local copy and
 * forks from it only when chosen; deleting a failed item leaves the root alone.
 */
export async function checkOfflineCreateAndDelete(ctx, repo) {
  const { account, page, r } = ctx;
  const offline = `${repo.origin}-offline`;
  renameSync(repo.origin, offline);
  try {
    const lastFetched = git(repo.root, 'rev-parse', 'origin/main');
    const worktreesBefore = git(repo.root, 'worktree', 'list', '--porcelain');
    const before = await listItemIds(account);
    const dialog = await openCreateDialog(page, repo.alias);
    await nameField(dialog).fill(`Phase 1 offline ${Date.now()}`);
    await waitFor(() => createButton(dialog).isEnabled(), 15_000, 'Create to be enabled');
    await createButton(dialog).click();
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });
    const item = await waitForNewItem(account, before, 'the offline item');
    ctx.created.push(item.id);
    const failed = await waitForProvision(account, item.id, 'failed');
    const errorType = JSON.parse(failed.provisionError ?? 'null')?.type;
    const choice = page.getByRole('button', {
      name: `Create from local copy of origin/main (${lastFetched.slice(0, 7)})`,
    });
    await choice.waitFor({ timeout: 30_000 });
    // Until the user chooses, nothing is forked: no checkout was added, and
    // the lane records no fork point. (Its path is the root until then.)
    const laneBefore = await primaryLane(account, item.id);
    const forkBefore = readForkColumns(account.instance.profileDir, laneBefore.id);
    const worktreesAtChoice = git(repo.root, 'worktree', 'list', '--porcelain');
    // devstation-dd6x: the sidebar row and the rail's lane row say the
    // checkout was not created — no "setup", which never ran.
    const rowSays = page.getByText('Checkout not created', { exact: true });
    const badge = page.getByText('not created', { exact: true });
    await rowSays.first().waitFor({ timeout: 15_000 });
    const sidebarSaysSetup = await page.getByText(/Workspace setup failed/).count();
    await page.screenshot({ path: r.shot('offline-banner') });
    r.check(
      'A failed checkout is named as one, in the sidebar row and on the rail lane',
      (await rowSays.first().isVisible()) &&
        (await badge.first().isVisible()) &&
        sidebarSaysSetup === 0,
      `row "Checkout not created", rail badge "not created", "Workspace setup failed" ×${sidebarSaysSetup}`
    );
    // devstation-kcvy: the banner says why in one sentence; what git said is
    // folded behind "Show git output", not run on after it.
    const sentence = page.getByText(
      'Could not fetch origin/main, so its newest commit is unknown.',
      { exact: true }
    );
    await sentence.waitFor({ timeout: 15_000 });
    const rawShown = await page
      .getByText(/Command failed/)
      .filter({ visible: true })
      .count();
    await page.getByRole('button', { name: 'Show git output' }).click();
    const gitSaid = page.getByText(/^fatal: /).filter({ visible: true });
    await gitSaid.first().waitFor({ timeout: 5_000 });
    await page.screenshot({ path: r.shot('offline-banner-git-output') });
    r.check(
      'A failed fetch reads as one sentence, with git\'s output folded behind "Show git output"',
      rawShown === 0 && (await gitSaid.count()) > 0,
      `"Command failed" shown before the fold ×${rawShown}; git's fatal lines after it ×${await gitSaid.count()}`
    );
    await choice.click();
    await waitForProvision(account, item.id, 'ready');
    const lane = await primaryLane(account, item.id);
    const fork = readForkColumns(account.instance.profileDir, lane.id);
    await page.getByText('local copy', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.screenshot({ path: r.shot('local-copy-lane') });
    r.check(
      'Offline create offers "Create from local copy" and forks from nothing stale until chosen',
      errorType === 'base_fetch_failed' &&
        worktreesAtChoice === worktreesBefore &&
        forkBefore.forkSha === null,
      `provision error ${errorType}; checkouts added before the choice: ` +
        `${worktreesAtChoice === worktreesBefore ? 'none' : 'some'}; fork_sha ${forkBefore.forkSha}`
    );
    r.check(
      "Choosing it records fork_source = 'local_copy' and forks from the last-fetched SHA",
      fork.forkSource === 'local_copy' &&
        fork.forkSha === lastFetched &&
        git(lane.path, 'rev-parse', 'HEAD') === lastFetched,
      `source ${fork.forkSource}, fork_sha ${fork.forkSha?.slice(0, 7)}, last fetched ${lastFetched.slice(0, 7)}`
    );

    const rootBefore = rootState(repo.root);
    const doomed = await tryCreate(account, {
      name: `Phase 1 doomed ${Date.now()}`,
      repoId: repo.repoId,
    });
    if (!doomed.success) throw new Error(`Offline create was refused: ${JSON.stringify(doomed)}`);
    await waitForProvision(account, doomed.data.item.id, 'failed');
    await account.call('workItems.remove', doomed.data.item.id);
    const remaining = await listItemIds(account);
    r.check(
      'Deleting a failed work item never touches the repository checkout',
      rootState(repo.root) === rootBefore &&
        existsSync(repo.root) &&
        !remaining.includes(doomed.data.item.id),
      `root branch ${git(repo.root, 'branch', '--show-current')}, ` +
        `status "${git(repo.root, 'status', '--porcelain')}", item removed`
    );
  } finally {
    renameSync(offline, repo.origin);
  }
}
