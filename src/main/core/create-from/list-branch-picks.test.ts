import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { testDb } from '@main/core/work-items/test-support/work-items-test-db';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { listBranchPicks } from './list-branch-picks';

/**
 * The Branches tab of Create from… (plan §Phase 3 slice 2): every branch the
 * repository can check out — local, plus every remote's branches this clone
 * has no local branch for — each with where it is checked out, if
 * anywhere. Git allows a branch in one worktree at a time, so a held branch is
 * listed with its holder (the main checkout, a Chord lane's work item, or a
 * worktree Chord doesn't own) and the picker never offers to reuse it.
 *
 * Real repositories on disk, real `git`, and the REAL SQLite database built
 * from the shipped migrations (`@main/db/client` is pointed at it).
 */
vi.mock('@main/db/client', async () => ({
  db: (await import('@main/core/work-items/test-support/work-items-test-db')).testDrizzle,
}));

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function configureIdentity(dir: string): Promise<void> {
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}

const REPO_ID = 'repo-create-from';

function insertRepo(repoPath: string): void {
  testDb
    .prepare('INSERT INTO repos (id, path, alias) VALUES (?, ?, ?)')
    .run(REPO_ID, repoPath, 'create-from');
}

function insertLane(args: {
  workItemId: string;
  workItemName: string;
  repoPath: string;
  lanePath: string;
  branch: string;
}): void {
  testDb
    .prepare(
      'INSERT INTO work_items (id, name, repo_id, repo_path, branch_name) VALUES (?, ?, ?, ?, ?)'
    )
    .run(args.workItemId, args.workItemName, REPO_ID, args.lanePath, args.branch);
  testDb
    .prepare(
      'INSERT INTO work_item_worktrees (id, work_item_id, path, branch_name, is_primary) VALUES (?, ?, ?, ?, 1)'
    )
    .run(`lane-${args.workItemId}`, args.workItemId, args.lanePath, args.branch);
}

describe('listBranchPicks', () => {
  let root: string;
  let remoteDir: string;
  let repoDir: string;
  let teammateRepo: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'create-from-branches-'));
    remoteDir = path.join(root, 'remote.git');
    repoDir = path.join(root, 'repo');
    teammateRepo = path.join(root, 'teammate');

    fs.mkdirSync(remoteDir);
    await git(['init', '--bare'], remoteDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remoteDir);
    fs.mkdirSync(teammateRepo);
    await git(['init'], teammateRepo);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], teammateRepo);
    await configureIdentity(teammateRepo);
    await git(['commit', '--allow-empty', '-m', 'init'], teammateRepo);
    await git(['remote', 'add', 'origin', remoteDir], teammateRepo);
    await git(['push', '-u', 'origin', 'main'], teammateRepo);
    await git(['switch', '-c', 'feat/teammate'], teammateRepo);
    await git(['commit', '--allow-empty', '-m', 'teammate work'], teammateRepo);
    await git(['push', 'origin', 'feat/teammate'], teammateRepo);
    await git(['switch', 'main'], teammateRepo);

    await git(['clone', remoteDir, repoDir], root);
    await configureIdentity(repoDir);
    insertRepo(repoDir);
  });

  afterEach(() => {
    testDb.exec('DELETE FROM work_item_worktrees');
    testDb.exec('DELETE FROM work_items');
    testDb.exec('DELETE FROM repos');
    removeDirSync(root);
  });

  async function listPicks() {
    const result = await listBranchPicks(REPO_ID);
    if (!result.success) throw new Error(`listBranchPicks failed: ${result.error.message}`);
    return result.data;
  }

  it('lists each branch once: local branches, then the remote-only ones by their own name', async () => {
    await git(['branch', 'feat/free'], repoDir);

    const picks = await listPicks();

    expect(picks.map((pick) => [pick.name, pick.source, pick.remote])).toEqual([
      ['feat/free', 'local', null],
      ['main', 'local', null],
      // The preferred remote's branch is listed by its own name, not
      // `origin/feat/teammate`.
      ['feat/teammate', 'remote', 'origin'],
    ]);
    // A local branch is checked out as itself; a remote one becomes a local
    // branch of its own name tracking it.
    expect(picks.find((pick) => pick.name === 'feat/free')).toMatchObject({
      localBranch: 'feat/free',
      tracking: null,
    });
    expect(picks.find((pick) => pick.name === 'feat/teammate')).toMatchObject({
      localBranch: 'feat/teammate',
      tracking: { remote: 'origin', branch: 'feat/teammate' },
    });
    // origin/main has a local main; origin/HEAD is not a branch.
    expect(picks.filter((pick) => pick.name === 'main')).toHaveLength(1);
    expect(picks.some((pick) => pick.name.includes('HEAD'))).toBe(false);
  });

  it("names the main checkout as the holder of the branch it's on", async () => {
    const picks = await listPicks();

    expect(picks.find((pick) => pick.name === 'main')?.holder).toEqual({
      kind: 'checkout',
      path: path.resolve(repoDir),
    });
  });

  it('names the work item whose lane has a branch checked out', async () => {
    await git(['branch', 'feat/busy'], repoDir);
    const lanePath = path.join(root, 'pool', 'busy');
    await git(['worktree', 'add', lanePath, 'feat/busy'], repoDir);
    insertLane({
      workItemId: 'item-busy',
      workItemName: 'Fix login redirect',
      repoPath: repoDir,
      lanePath,
      branch: 'feat/busy',
    });

    const picks = await listPicks();

    expect(picks.find((pick) => pick.name === 'feat/busy')?.holder).toEqual({
      kind: 'work_item',
      path: path.resolve(lanePath),
      workItemId: 'item-busy',
      workItemName: 'Fix login redirect',
    });
  });

  it("names the folder of a worktree Chord doesn't own", async () => {
    await git(['branch', 'feat/outside'], repoDir);
    const outside = path.join(root, 'by-hand');
    await git(['worktree', 'add', outside, 'feat/outside'], repoDir);

    const picks = await listPicks();

    expect(picks.find((pick) => pick.name === 'feat/outside')?.holder).toEqual({
      kind: 'checkout',
      path: path.resolve(outside),
    });
  });

  it('lists a branch nothing has checked out with no holder', async () => {
    await git(['branch', 'feat/free'], repoDir);

    const picks = await listPicks();

    expect(picks.find((pick) => pick.name === 'feat/free')?.holder).toBeNull();
    expect(picks.find((pick) => pick.name === 'feat/teammate')?.holder).toBeNull();
  });

  it('does not hold a branch for a checkout folder deleted outside git', async () => {
    await git(['branch', 'feat/gone'], repoDir);
    const gone = path.join(root, 'pool', 'gone');
    await git(['worktree', 'add', gone, 'feat/gone'], repoDir);
    removeDirSync(gone);

    const picks = await listPicks();

    // Same answer the create preflight gives (it prunes too): the branch is free.
    expect(picks.find((pick) => pick.name === 'feat/gone')?.holder).toBeNull();
  });

  /**
   * Another remote's branch is listed as `<remote>/<branch>` and checks out as
   * a local branch tracking it, named the way `gh pr checkout` names a fork's
   * branch: its own name, or `<remote>/<branch>` when that name already means
   * something else here (the preferred remote has a branch of that name, or a
   * local branch of that name tracks something else).
   */
  describe('a branch on another remote', () => {
    let upstreamDir: string;

    beforeEach(async () => {
      upstreamDir = path.join(root, 'upstream.git');
      fs.mkdirSync(upstreamDir);
      await git(['init', '--bare'], upstreamDir);
      await git(['remote', 'add', 'upstream', upstreamDir], teammateRepo);
      await git(['push', 'upstream', 'main'], teammateRepo);
      for (const branch of ['feature-up', 'shared']) {
        await git(['switch', '-c', branch, 'main'], teammateRepo);
        await git(['commit', '--allow-empty', '-m', `${branch} work`], teammateRepo);
        await git(['push', 'upstream', branch], teammateRepo);
      }
      await git(['push', 'origin', 'shared'], teammateRepo);
      await git(['switch', 'main'], teammateRepo);

      await git(['remote', 'add', 'upstream', upstreamDir], repoDir);
      await git(['fetch', 'upstream'], repoDir);
      await git(['fetch', 'origin'], repoDir);
    });

    it('is listed as <remote>/<branch> and checks out as its own name, tracking that remote', async () => {
      const picks = await listPicks();

      expect(picks.find((pick) => pick.name === 'upstream/feature-up')).toEqual({
        name: 'upstream/feature-up',
        source: 'remote',
        remote: 'upstream',
        localBranch: 'feature-up',
        tracking: { remote: 'upstream', branch: 'feature-up' },
        holder: null,
      });
    });

    it('is listed once per remote when two remotes have it', async () => {
      const picks = await listPicks();

      const shared = picks.filter(
        (pick) => pick.name === 'shared' || pick.name.endsWith('/shared')
      );
      expect(shared.map((pick) => [pick.name, pick.localBranch, pick.tracking])).toEqual([
        ['shared', 'shared', { remote: 'origin', branch: 'shared' }],
        // `shared` is origin's: upstream's checks out under its remote's name.
        ['upstream/shared', 'upstream/shared', { remote: 'upstream', branch: 'shared' }],
      ]);
      // upstream's main: `main` is origin's (and checked out in the root).
      expect(picks.find((pick) => pick.name === 'upstream/main')).toMatchObject({
        localBranch: 'upstream/main',
        tracking: { remote: 'upstream', branch: 'main' },
      });
    });

    it('checks out under its remote’s name when a local branch of its name is something else', async () => {
      await git(['branch', 'feature-up', 'main'], repoDir);

      const picks = await listPicks();

      expect(picks.find((pick) => pick.name === 'upstream/feature-up')).toMatchObject({
        localBranch: 'upstream/feature-up',
        tracking: { remote: 'upstream', branch: 'feature-up' },
      });
    });

    it('is the local branch, with its holder, once a lane has checked it out tracking that remote', async () => {
      await git(['branch', '--track', 'feature-up', 'refs/remotes/upstream/feature-up'], repoDir);
      const lanePath = path.join(root, 'pool', 'feature-up');
      await git(['worktree', 'add', lanePath, 'feature-up'], repoDir);
      insertLane({
        workItemId: 'item-up',
        workItemName: 'Upstream work',
        repoPath: repoDir,
        lanePath,
        branch: 'feature-up',
      });

      const picks = await listPicks();

      expect(picks.find((pick) => pick.name === 'feature-up')).toMatchObject({
        source: 'local',
        localBranch: 'feature-up',
        holder: { kind: 'work_item', workItemName: 'Upstream work', path: path.resolve(lanePath) },
      });
      // Not listed a second time as a remote branch to check out again.
      expect(picks.some((pick) => pick.name === 'upstream/feature-up')).toBe(false);
    });
  });

  it('refuses a repository id that is not registered', async () => {
    const result = await listBranchPicks('repo-unknown');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('no_repo');
    expect(result.error.message).toContain('repo-unknown');
  });
});
