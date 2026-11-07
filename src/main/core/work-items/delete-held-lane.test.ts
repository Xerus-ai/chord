import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * devstation-4x42.255: deleting a work item left its lane's folder behind,
 * empty, on Windows. What holds a checkout is a process whose cwd is in it:
 * at that moment `git worktree remove --force` deletes the files, the `.git`
 * file and the registration, then fails to delete the folder ("Permission
 * denied") and exits non-zero. Nothing removed it later, because git no longer
 * knew it as a worktree and `deleteWorkItem` logs a failed removal and goes
 * on. A holder that lets go within the hold bound no longer leaves anything.
 * Real repository, real process, the real delete path; Electron's keychain and
 * the database are the substitutes the other removal suites use.
 */
vi.mock('electron', () => import('@main/core/account/_testing/test-keychain-electron'));
vi.mock('@main/db/client', () => import('@main/db/_testing/test-db-client'));

const { addWorktree, createScratchRepo, listGitWorktrees } = await import(
  '@main/core/worktree-sources/_testing/scratch-worktrees'
);
const { db } = await import('@main/db/client');
const { repos, workItems, workItemWorktrees } = await import('@main/db/schema-work-items');
const { deleteWorkItem } = await import('./work-item-crud');

const REPO_ID = 'repo-1';
const ITEM_ID = 'item-1';
const LANE_ID = 'lane-1';
const scratch = createScratchRepo('chord-delete-held-');
let run = 0;
let lane: string;

afterAll(() => {
  removeDirSync(scratch.root);
});

beforeEach(async () => {
  run += 1;
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: REPO_ID, path: scratch.repo, alias: 'repo' });
  const branch = `chord/held-${run}`;
  lane = addWorktree(scratch.repo, path.join(scratch.root, 'pool', `held-${run}`), branch);
  await db.insert(workItems).values({
    id: ITEM_ID,
    name: 'Held',
    repoId: REPO_ID,
    repoPath: lane,
    branchName: branch,
    provisionStatus: 'ready',
  });
  await db.insert(workItemWorktrees).values({
    id: LANE_ID,
    workItemId: ITEM_ID,
    path: lane,
    branchName: branch,
    isPrimary: 1,
    targetRef: 'origin/main',
    setupStatus: 'ok',
    checkoutOrigin: 'chord',
  });
});

describe('deleting a work item whose lane a process still holds', () => {
  let holder: ChildProcess | null = null;

  afterEach(() => {
    holder?.kill();
    holder = null;
  });

  it('removes the checkout folder once the holder lets go, not just its files', async () => {
    // Alive until the test lets it go: never before git's first attempt has run.
    const held = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: lane });
    holder = held;
    await new Promise((resolve) => held.once('spawn', resolve));

    let settled = false;
    const deletion = deleteWorkItem(ITEM_ID).finally(() => {
      settled = true;
    });
    // git's first attempt is over once its admin folder is gone: git deletes it only after it
    // tried the checkout folder. Letting go earlier would let that attempt itself succeed.
    const admin = path.join(scratch.repo, '.git', 'worktrees', `held-${run}`);
    await vi.waitFor(() => expect(settled || !existsSync(admin)).toBe(true), {
      timeout: 8_000,
      interval: 25,
    });
    // On Windows the holder keeps the emptied folder while the removal waits out the hold.
    const folderHeld = existsSync(lane);
    const exited = new Promise((resolve) => held.once('exit', resolve));
    held.kill();
    await exited;

    expect(await deletion).toEqual({ success: true, data: undefined });

    if (process.platform === 'win32') expect(folderHeld).toBe(true);
    expect(existsSync(lane)).toBe(false);
    expect(listGitWorktrees(scratch.repo)).not.toContain(`held-${run}`);
  }, 30_000);
});
