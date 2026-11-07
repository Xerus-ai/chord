import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('removes the checkout folder once the holder lets go, not just its files', async () => {
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { cwd: lane });
    await new Promise((resolve) => holder.once('spawn', resolve));

    expect(await deleteWorkItem(ITEM_ID)).toEqual({ success: true, data: undefined });

    expect(existsSync(lane)).toBe(false);
    expect(listGitWorktrees(scratch.repo)).not.toContain(`held-${run}`);
  }, 30_000);
});
