/**
 * What the Phase 1 checks share (plan 2026-09-26 §Phase 1, devstation-cz3a):
 * scratch repositories with a bare origin, results and screenshots, the
 * create dialog, and a lane's rows as main stored them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { E2E_SHOTS_DIR } from '../experience/run-record.mjs';
import { waitFor } from '../sharing/sharing-accounts.mjs';

const SHOTS = E2E_SHOTS_DIR;

export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

export function createResults() {
  const results = [];
  let shotCount = 0;
  mkdirSync(SHOTS, { recursive: true });
  return {
    results,
    check(name, ok, detail) {
      results.push({ name, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    },
    shot: (name) => join(SHOTS, `phase1-${String(++shotCount).padStart(2, '0')}-${name}.png`),
  };
}

/**
 * origin (bare) with main = [README.md, and `.chord.json` when `config` is
 * given: `config(marksArg)`]; `author` pushes to it, `root` is the clone Chord
 * registers. `marks` is a folder outside every checkout for scripts to write
 * to; `marksArg` is it with forward slashes, for commands.
 */
export function createScratchRepo(label, config) {
  const scratch = mkdtempSync(join(tmpdir(), `chord-phase1-${label}-`));
  const origin = join(scratch, 'origin.git');
  const author = join(scratch, 'author');
  const root = join(scratch, label);
  const marks = join(scratch, 'marks');
  const marksArg = marks.replace(/\\/g, '/');
  mkdirSync(marks);
  git(scratch, 'init', '-q', '--bare', '-b', 'main', origin);
  git(scratch, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), `# phase 1 ${label}\n`);
  if (config) {
    writeFileSync(join(author, '.chord.json'), `${JSON.stringify(config(marksArg), null, 2)}\n`);
  }
  git(author, 'add', '.');
  git(author, 'commit', '-q', '-m', 'first');
  git(author, 'push', '-q', 'origin', 'main');
  git(scratch, 'clone', '-q', origin, root);
  git(root, 'config', 'user.email', 'e2e@chord.invalid');
  git(root, 'config', 'user.name', 'Chord e2e');
  return { scratch, origin, author, root, marks, marksArg };
}

/** A commit on origin's main that `root` has not fetched. Returns its SHA. */
export function pushRemoteOnly(repo, file) {
  writeFileSync(join(repo.author, file), `${file}\n`);
  git(repo.author, 'add', '.');
  git(repo.author, 'commit', '-q', '-m', file);
  git(repo.author, 'push', '-q', 'origin', 'main');
  return git(repo.author, 'rev-parse', 'HEAD');
}

/** What a check compares to say a repository's main checkout was left alone. */
export function rootState(root) {
  return [
    git(root, 'branch', '--show-current'),
    git(root, 'rev-parse', 'HEAD'),
    git(root, 'status', '--porcelain'),
    git(root, 'worktree', 'list', '--porcelain'),
  ].join('\n');
}

/** Opens New work item with the repository `alias` chosen. */
export async function openCreateDialog(page, alias) {
  await page.getByRole('button', { name: /^New work item/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Create work item', { exact: true }).waitFor({ timeout: 15_000 });
  await dialog.locator('button[aria-haspopup="menu"]').first().click();
  await dialog.getByRole('menu').getByText(alias, { exact: true }).click();
  return dialog;
}

export const nameField = (dialog) => dialog.getByPlaceholder(/ticket URL/);
export const createButton = (dialog) => dialog.getByRole('button', { name: /^Create/ });

export async function listItemIds(account) {
  return (await account.call('workItems.getAll')).items.map((item) => item.id);
}

/** The work item `before` did not have, once there is exactly one. */
export async function waitForNewItem(account, before, what) {
  let item = null;
  await waitFor(
    async () => {
      const { items } = await account.call('workItems.getAll');
      const fresh = items.filter((w) => !before.includes(w.id));
      item = fresh.length === 1 ? fresh[0] : null;
      return item !== null;
    },
    30_000,
    what
  );
  return item;
}

/** Waits for the work item's provision status to be `status`; returns the item. */
export async function waitForProvision(account, workItemId, status, timeoutMs = 120_000) {
  let item = null;
  await waitFor(
    async () => {
      const { items } = await account.call('workItems.getAll');
      item = items.find((w) => w.id === workItemId);
      return item?.provisionStatus === status;
    },
    timeoutMs,
    `work item ${workItemId} to be ${status}`
  );
  return item;
}

export async function primaryLane(account, workItemId) {
  const { worktrees } = await account.call('worktrees.list', workItemId);
  return worktrees.find((w) => w.isPrimary) ?? null;
}

/** Waits for the primary lane's setup status to be `status`; returns the lane. */
export async function waitForSetup(account, workItemId, status, timeoutMs = 120_000) {
  let lane = null;
  await waitFor(
    async () => {
      lane = await primaryLane(account, workItemId);
      return lane?.setupStatus === status;
    },
    timeoutMs,
    `setup to be ${status}`
  );
  return lane;
}

/** The lane's stored fork columns, read from the running app's database. */
export function readForkColumns(profileDir, laneId) {
  const db = new DatabaseSync(join(profileDir, 'chord.db'), { readOnly: true });
  try {
    return db
      .prepare(
        'SELECT fork_sha AS forkSha, fork_source AS forkSource, target_ref AS targetRef ' +
          'FROM work_item_worktrees WHERE id = ?'
      )
      .get(laneId);
  } finally {
    db.close();
  }
}

/** `workItems.create` as the raw result, so a refusal can be read rather than thrown. */
export function tryCreate(account, args) {
  return account.instance.rpc('workItems.create', args);
}
