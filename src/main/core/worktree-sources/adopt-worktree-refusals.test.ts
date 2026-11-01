import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * What Adopt refuses, typed, before anything is written (plan §Phase 3
 * slice 6): a detached checkout (`no_branch`), a folder git no longer lists
 * (`not_a_worktree`), and a branch a lane already holds whose folder was
 * removed outside git (`stale_lane`, with "Point lane at this folder").
 * Real repositories and the real schema.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { addWorktree, createScratchRepo, git, readCheckoutState } = await import(
  './_testing/scratch-worktrees'
);
const { db } = await import('@main/db/client');
const { repos, workItems, workItemWorktrees } = await import('@main/db/schema-work-items');
const { adoptWorktree } = await import('./adopt-worktree');
const { discoverRepoWorktrees } = await import('./discover-repo-worktrees');
const { pointLaneAtFolder } = await import('./point-lane-at-folder');

const REPO_ID = 'repo-1';
const STALE_ITEM = 'item-stale';
const STALE_LANE = 'lane-stale';
const SENDER = { id: null, name: 'Ana' };
const scratch = createScratchRepo('chord-adopt-refusals-');

afterAll(() => {
  removeDirSync(scratch.root);
});

beforeEach(async () => {
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: REPO_ID, path: scratch.repo, alias: 'repo' });
});

function adopt(folder: string) {
  return adoptWorktree({
    repoId: REPO_ID,
    path: folder,
    name: 'Adopted',
    sessions: [],
    sender: SENDER,
  });
}

function expectNothingWritten() {
  expect(db.select().from(workItems).all()).toEqual([]);
  expect(db.select().from(workItemWorktrees).all()).toEqual([]);
}

describe('adoptWorktree refusals', () => {
  it('refuses a detached checkout as no_branch', async () => {
    const detached = addWorktree(
      scratch.repo,
      path.join(scratch.root, 'elsewhere', 'detached'),
      null
    );

    const result = await adopt(detached);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'no_branch' });
    expectNothingWritten();
  });

  it('refuses a worktree whose folder is gone as not_a_worktree', async () => {
    const gone = addWorktree(scratch.repo, path.join(scratch.root, 'elsewhere', 'gone'), 'gone');
    removeDirSync(gone);

    const result = await adopt(gone);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'not_a_worktree' });
    expectNothingWritten();
    git(scratch.repo, 'worktree', 'prune');
  });

  it('refuses a folder git does not list as one of the repository’s worktrees', async () => {
    const plain = path.join(scratch.root, 'elsewhere', 'plain-folder');
    mkdirSync(plain, { recursive: true });

    const result = await adopt(plain);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'not_a_worktree' });
    expectNothingWritten();
  });

  it("refuses the repository's main checkout as not_a_worktree", async () => {
    const result = await adopt(scratch.repo);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'not_a_worktree' });
    expectNothingWritten();
  });

  it('refuses a folder a lane already holds as already_adopted, naming the lane', async () => {
    const twice = addWorktree(
      scratch.repo,
      path.join(scratch.root, 'elsewhere', 'adopted-twice'),
      'feature/adopted-twice'
    );
    const first = await adopt(twice);
    if (!first.success) throw new Error(`first adopt refused: ${JSON.stringify(first.error)}`);

    // A second Adopt of the same folder, e.g. a double click.
    expect(await adopt(twice)).toEqual({
      success: false,
      error: { type: 'already_adopted', laneId: first.data.worktreeId },
    });
    expect(
      db
        .select()
        .from(workItems)
        .all()
        .map((w) => w.id)
    ).toEqual([first.data.workItemId]);
    expect(db.select().from(workItemWorktrees).all()).toHaveLength(1);
  });
});

describe('a lane whose folder was removed outside git', () => {
  let laneFolder: string;
  let found: string;

  beforeEach(async () => {
    // The lane's folder is deleted outside git, git forgets it, and the same
    // branch is checked out again somewhere else.
    const branch = `feature/stale-${Date.now()}`;
    laneFolder = addWorktree(
      scratch.repo,
      path.join(scratch.root, 'pool', `stale-${Date.now()}`),
      branch
    );
    removeDirSync(laneFolder);
    git(scratch.repo, 'worktree', 'prune');
    found = path.join(scratch.root, 'elsewhere', `found-${Date.now()}`);
    mkdirSync(path.dirname(found), { recursive: true });
    git(scratch.repo, 'worktree', 'add', '-q', found, branch);

    await db.insert(workItems).values({
      id: STALE_ITEM,
      name: 'Stale',
      repoId: REPO_ID,
      repoPath: laneFolder,
      branchName: branch,
      provisionStatus: 'ready',
    });
    await db.insert(workItemWorktrees).values({
      id: STALE_LANE,
      workItemId: STALE_ITEM,
      path: laneFolder,
      branchName: branch,
      isPrimary: 1,
      targetRef: 'origin/main',
      setupStatus: 'ok',
    });
  });

  it('refuses Adopt as stale_lane, naming the lane and its old folder', async () => {
    expect(await adopt(found)).toEqual({
      success: false,
      error: { type: 'stale_lane', laneId: STALE_LANE, path: laneFolder },
    });
    expect(
      db
        .select()
        .from(workItems)
        .all()
        .map((w) => w.id)
    ).toEqual([STALE_ITEM]);
  });

  it('"Point lane at this folder" moves the lane there as the user’s checkout, changing nothing in it', async () => {
    const before = readCheckoutState(found);

    const result = await pointLaneAtFolder({ laneId: STALE_LANE, path: found });

    expect(result.success).toBe(true);
    const [lane] = db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.id, STALE_LANE))
      .all();
    expect(lane).toMatchObject({ path: found, checkoutOrigin: 'adopted' });
    // The primary lane is where the work item runs.
    const [item] = db.select().from(workItems).where(eq(workItems.id, STALE_ITEM)).all();
    expect(item.repoPath).toBe(found);
    expect(readCheckoutState(found)).toEqual(before);
    expect((await discoverRepoWorktrees(REPO_ID)).map((w) => w.path)).not.toContain(found);
  });

  it('refuses to point the lane at a folder git does not list', async () => {
    const plain = path.join(scratch.root, 'elsewhere', `plain-${Date.now()}`);
    mkdirSync(plain, { recursive: true });

    const result = await pointLaneAtFolder({ laneId: STALE_LANE, path: plain });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'not_a_worktree' });
    const [lane] = db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.id, STALE_LANE))
      .all();
    expect(lane.path).toBe(laneFolder);
  });
});
