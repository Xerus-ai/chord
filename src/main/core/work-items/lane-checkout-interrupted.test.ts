import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { provisionLaneCheckout } from './lane-checkout';

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function configureIdentity(dir: string): Promise<void> {
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}

/** `git worktree list --porcelain` as `{path, branch}`, the main checkout first. */
async function listCheckouts(repoDir: string): Promise<{ path: string; branch: string | null }[]> {
  const out = await git(['worktree', 'list', '--porcelain'], repoDir);
  return out.split(/\n\n+/).map((block) => {
    const lines = block.split('\n');
    const worktree = lines.find((line) => line.startsWith('worktree '))!;
    const branch = lines.find((line) => line.startsWith('branch '));
    return {
      path: path.resolve(worktree.slice('worktree '.length)),
      branch: branch ? branch.slice('branch refs/heads/'.length) : null,
    };
  });
}

/**
 * devstation-dq2. Chord can die while `git worktree add` runs: git finishes on
 * its own, so the branch and its checkout exist, but the row never moved to
 * them (`work-item-crud.ts` runWorkItemProvisioning). The next start marks the
 * item `interrupted`, and Retry asked for the same branch again — refused as
 * `branch_exists`, forever.
 *
 * On a Retry of an interrupted item the checkout is this item's when, and only
 * when, both match: git has its chord-named branch checked out, and at a folder
 * directly in this repository's pool. Anything else is not taken over.
 *
 * The interruption is simulated by running the engine's own `worktree add`
 * (`worktree-service.ts` doCheckoutNewBranch) without the database update.
 */
describe('provisionLaneCheckout after an interrupted create', () => {
  const BRANCH = 'chord/fix-login-a1b';
  let root: string;
  let remoteDir: string;
  let repoDir: string;
  let poolDir: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-interrupted-'));
    remoteDir = path.join(root, 'remote.git');
    repoDir = path.join(root, 'repo');
    poolDir = path.join(root, 'pool');

    const seed = path.join(root, 'seed');
    fs.mkdirSync(remoteDir);
    await git(['init', '--bare'], remoteDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remoteDir);
    fs.mkdirSync(seed);
    await git(['init'], seed);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], seed);
    await configureIdentity(seed);
    await git(['commit', '--allow-empty', '-m', 'init'], seed);
    await git(['remote', 'add', 'origin', remoteDir], seed);
    await git(['push', '-u', 'origin', 'main'], seed);

    await git(['clone', remoteDir, repoDir], root);
    await configureIdentity(repoDir);
    fs.mkdirSync(poolDir);
  });

  afterEach(() => {
    removeDirSync(root);
  });

  /** What git leaves behind when the app dies right after `worktree add`. */
  async function interruptCreate(branch: string, checkout: string): Promise<string> {
    const forkSha = await git(['rev-parse', 'origin/main'], repoDir);
    await git(['worktree', 'add', '--no-track', '-b', branch, checkout, forkSha], repoDir);
    return forkSha;
  }

  it('uses its own interrupted checkout instead of creating it again', async () => {
    const checkout = path.join(poolDir, 'fix-login-a1b');
    const forkSha = await interruptCreate(BRANCH, checkout);

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: BRANCH },
      resumeInterrupted: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(path.resolve(result.data.worktreePath)).toBe(checkout);
    expect(result.data.slug).toBe('fix-login-a1b');
    expect(result.data.branchName).toBe(BRANCH);
    expect(result.data.branchOrigin).toBe('chord');
    expect(result.data.targetRef).toBe('origin/main');
    // Nothing ran in the checkout while the app was down: its tip is the fork.
    expect(result.data.forkSha).toBe(forkSha);
    // No second checkout, no `-2` folder.
    expect(await listCheckouts(repoDir)).toHaveLength(2);
    expect(fs.readdirSync(poolDir)).toEqual(['fix-login-a1b']);
  });

  it('still refuses the existing branch on a create that was not interrupted', async () => {
    await interruptCreate(BRANCH, path.join(poolDir, 'fix-login-a1b'));

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: BRANCH },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'branch_exists', branch: BRANCH });
  });

  it('never takes over a checkout of its branch outside the pool', async () => {
    const elsewhere = path.join(root, 'elsewhere');
    await interruptCreate(BRANCH, elsewhere);
    const before = await listCheckouts(repoDir);

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: BRANCH },
      resumeInterrupted: true,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'branch_checked_out', branch: BRANCH });
    if (result.error.type !== 'branch_checked_out') return;
    expect(path.resolve(result.error.path)).toBe(elsewhere);
    expect(await listCheckouts(repoDir)).toEqual(before);
    expect(fs.readdirSync(poolDir)).toEqual([]);
  });

  it('never takes over a pool checkout that holds another branch', async () => {
    const foreign = path.join(poolDir, 'fix-login-a1b');
    await interruptCreate('bob/fix-login-a1b', foreign);

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: BRANCH },
      resumeInterrupted: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(path.resolve(result.data.worktreePath)).toBe(path.join(poolDir, 'fix-login-a1b-2'));
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], foreign)).toBe('bob/fix-login-a1b');
  });

  it('never takes over a checkout of its branch nested below the pool', async () => {
    const nested = path.join(poolDir, 'other-repo', 'fix-login-a1b');
    await interruptCreate(BRANCH, nested);

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: BRANCH },
      resumeInterrupted: true,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'branch_checked_out', branch: BRANCH });
  });
});
