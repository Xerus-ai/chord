/**
 * Live checks for the left rail's lane rows (plan §Phase 3 slice 3, P16;
 * devstation-arx.3), driven through the real UI:
 *   - each lane row reads "branch → target";
 *   - Copy branch puts the lane's branch on the clipboard;
 *   - Open focuses the work item on that lane: a lane with nothing running
 *     gets a terminal in it, a lane with a session gets that session;
 *   - Promote makes a secondary lane the primary;
 *   - the primary's Delete is shown disabled, with what to do instead;
 *   - Delete on a secondary lane names the uncommitted work it will lose,
 *     stops its terminal, removes its checkout and keeps its branch.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-lanes node scripts/e2e/left-rail-lanes.mjs
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder, with no .chord.json, so no "Run scripts?" window opens. Its work
 * item is deleted in the app, and the suite waits until the cloud no longer
 * has it. Screenshots: screenshots/e2e/left-rail-lanes-*.png.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readBandState } from './band-state.mjs';
import { E2E_SHOTS_DIR } from './experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from './sharing/sharing-accounts.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `left-rail-lanes-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const PRIMARY_DELETE_REASON = 'Promote another branch first, or delete the work item';

/** origin (bare) with main = [readme]; the clone Chord registers as the repository. */
function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-lanes-'));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'left-rail-lanes');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# left rail lanes\n');
  git(author, 'add', 'README.md');
  git(author, 'commit', '-q', '-m', 'readme');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  return { root, repo };
}

const laneRow = (page, laneId) => page.locator(`[data-lane-row="${laneId}"]`);

/** Opens a lane row's menu through its hover kebab. */
async function openLaneMenu(page, laneId) {
  const row = laneRow(page, laneId);
  await row.hover();
  await row.getByRole('button', { name: 'Branch actions' }).click();
  await page.getByRole('menuitem').first().waitFor({ timeout: 10_000 });
}

async function listLanes(account, workItemId) {
  return (await account.call('worktrees.list', workItemId)).worktrees;
}

async function laneSessions(account, workItemId, laneId) {
  const { sessions } = await account.call('agentSessions.getAll', workItemId);
  return sessions.filter((s) => s.worktreeId === laneId && s.status !== 'done');
}

function branchExists(repo, branch) {
  return git(repo, 'branch', '--list', branch) !== '';
}

async function checkRouteLabels(page, lanes) {
  for (const lane of lanes) {
    const row = laneRow(page, lane.id);
    await row.waitFor({ timeout: 30_000 });
    const expected = `${lane.branchName} → ${lane.targetRef}`;
    const text = await row.innerText();
    verdict(
      `${lane.isPrimary ? 'primary' : 'secondary'} row reads "branch → target"`,
      text.includes(expected),
      `expected "${expected}", row text "${text.replace(/\s+/g, ' ')}"`
    );
  }
}

async function checkCopyBranch(page, app, lane) {
  await openLaneMenu(page, lane.id);
  await page.screenshot({ path: shot('secondary-menu') });
  await page.getByRole('menuitem', { name: 'Copy branch' }).click();
  let copied = '';
  await waitFor(
    async () => {
      copied = await app.evaluate(({ clipboard }) => clipboard.readText());
      return copied === lane.branchName;
    },
    10_000,
    'the branch on the clipboard'
  ).catch(() => {});
  verdict('Copy branch puts the lane branch on the clipboard', copied === lane.branchName, copied);
}

/** Open on a lane: returns the session the item ended up focused on. */
async function openLane(account, page, workItemId, lane, what) {
  await openLaneMenu(page, lane.id);
  await page.getByRole('menuitem', { name: 'Open' }).click();
  let sessions = [];
  await waitFor(
    async () => {
      sessions = await laneSessions(account, workItemId, lane.id);
      return sessions.length > 0;
    },
    30_000,
    `a session in ${what}`
  );
  await laneRow(page, lane.id)
    .and(page.locator('[data-focused="true"]'))
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  const focused = (await laneRow(page, lane.id).getAttribute('data-focused')) === 'true';
  await page.screenshot({ path: shot(`open-${what.replace(/\s+/g, '-')}`) });
  verdict(`Open focuses the work item on ${what}`, focused, `data-focused=${focused}`);
  return sessions;
}

async function checkPromote(account, page, workItemId, lane) {
  await openLaneMenu(page, lane.id);
  await page.getByRole('menuitem', { name: 'Promote to primary' }).click();
  let promoted = null;
  await waitFor(
    async () => {
      promoted = (await listLanes(account, workItemId)).find((w) => w.id === lane.id);
      return promoted?.isPrimary === true;
    },
    20_000,
    'the lane to become primary'
  ).catch(() => {});
  const { items } = await account.call('workItems.getAll');
  const item = items.find((w) => w.id === workItemId);
  verdict(
    'Promote makes the lane primary and moves the work item to its checkout',
    promoted?.isPrimary === true && resolve(item.repoPath) === resolve(lane.path),
    `isPrimary=${promoted?.isPrimary}, repoPath=${item.repoPath}`
  );
  await laneRow(page, lane.id)
    .and(page.locator('[data-primary="true"]'))
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  verdict(
    'the promoted row is marked primary in the rail',
    (await laneRow(page, lane.id).getAttribute('data-primary')) === 'true',
    'data-primary on the row'
  );
  await page.screenshot({ path: shot('promoted') });
}

async function checkPrimaryDeleteDisabled(page, lane) {
  await openLaneMenu(page, lane.id);
  const item = page.getByRole('menuitem').filter({ hasText: 'Delete' });
  const disabled =
    (await item.getAttribute('aria-disabled')) === 'true' ||
    (await item.getAttribute('data-disabled')) !== null;
  const text = (await item.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: shot('primary-delete-disabled') });
  verdict('the primary’s Delete is disabled', disabled, `aria-disabled/data-disabled: ${disabled}`);
  verdict(
    'the primary’s Delete says what to do instead',
    text.includes(PRIMARY_DELETE_REASON),
    text
  );
  await page.keyboard.press('Escape');
}

async function checkDeleteSecondary(account, page, workItemId, lane, repo, sessionIds) {
  // Uncommitted work the confirm must name before it is lost.
  writeFileSync(join(lane.path, 'draft.txt'), 'not committed\n');
  await openLaneMenu(page, lane.id);
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: `Delete ${lane.branchName}?` });
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByText(/uncommitted change/).waitFor({ timeout: 15_000 });
  const text = (await dialog.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: shot('delete-confirm') });
  verdict(
    'the confirm names the uncommitted work that will be lost',
    text.includes('1 uncommitted change in the checkout will be lost'),
    text
  );
  verdict(
    'the confirm says the branch stays',
    text.includes('The branch and its commits stay in the repository'),
    'branch kept'
  );
  await dialog.getByRole('button', { name: /^Delete/ }).click();

  let lanes = [];
  await waitFor(
    async () => {
      lanes = await listLanes(account, workItemId);
      return !lanes.some((w) => w.id === lane.id);
    },
    60_000,
    'the lane row to be deleted'
  ).catch(() => {});
  verdict(
    'Delete removes the lane',
    !lanes.some((w) => w.id === lane.id),
    `${lanes.length} lane(s) left`
  );
  verdict('Delete removes the checkout folder', !existsSync(lane.path), lane.path);
  // Whole entries: a substring check also matched the other lane's path when
  // one path is a prefix of the other.
  const listed = git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => resolve(l.slice('worktree '.length)).toLowerCase());
  verdict(
    'Delete leaves git without the checkout',
    !listed.includes(resolve(lane.path).toLowerCase()),
    'git worktree list'
  );
  verdict('Delete keeps the branch', branchExists(repo, lane.branchName), lane.branchName);
  const { sessions } = await account.call('agentSessions.getAll', workItemId);
  verdict(
    'Delete stops and removes the lane’s terminal',
    !sessions.some((s) => sessionIds.includes(s.id)),
    `lane sessions ${sessionIds.join(', ')}`
  );
  await laneRow(page, lane.id)
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {});
  verdict(
    'the deleted row leaves the rail',
    (await laneRow(page, lane.id).count()) === 0,
    'row detached'
  );
  await page.screenshot({ path: shot('after-delete') });
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'lanes' });
  const { page, app } = account.instance;
  let workItem = null;
  try {
    const { repo } = await account.call('repos.create', {
      path: scratch.repo,
      alias: 'left-rail-lanes',
    });
    const created = await account.call('workItems.create', {
      name: `Chord e2e lanes ${Date.now()}`,
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
    await account.call('worktrees.create', { workItemId: workItem.id, title: 'second lane' });

    const lanes = await listLanes(account, workItem.id);
    const first = lanes.find((w) => w.isPrimary);
    const second = lanes.find((w) => !w.isPrimary);
    verdict('the work item has a second lane', !!first && !!second, `${lanes.length} lanes`);

    // The active work item's card shows its lanes.
    await page.getByText(workItem.name, { exact: true }).first().click();
    await checkRouteLabels(page, lanes);
    await page.screenshot({ path: shot('lane-rows') });

    await checkCopyBranch(page, app, second);
    const secondSessions = await openLane(account, page, workItem.id, second, 'the empty lane');
    verdict(
      'Open on an empty lane starts one terminal there',
      secondSessions.length === 1 && secondSessions[0].kind === 'terminal',
      secondSessions.map((s) => `${s.kind}:${s.id}`).join(', ')
    );
    // devstation-dh2: the second lane's branch was never pushed; the band read
    // "Pushed · no pull request" because its commits are main's, which are.
    let band = null;
    await waitFor(
      async () => (band = await readBandState(page)) === 'Not published',
      30_000,
      'the band to read Not published'
    ).catch(() => {});
    await page.screenshot({ path: shot('band-unpublished-lane') });
    verdict('the band on a lane never pushed reads Not published', band === 'Not published', band);
    const again = await openLane(account, page, workItem.id, second, 'a lane with a session');
    verdict(
      'Open on a lane with a session focuses it rather than starting another',
      again.length === 1 && again[0].id === secondSessions[0].id,
      again.map((s) => s.id).join(', ')
    );

    await checkPromote(account, page, workItem.id, second);
    await checkPrimaryDeleteDisabled(page, second);

    const firstSessions = await openLane(account, page, workItem.id, first, 'the former primary');
    await checkDeleteSecondary(
      account,
      page,
      workItem.id,
      first,
      scratch.repo,
      firstSessions.map((s) => s.id)
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
