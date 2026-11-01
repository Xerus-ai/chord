import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { LocalWorktreeHost } from './hosts/local-worktree-host';
import type { WorktreeHost } from './hosts/worktree-host';
import { WorktreeService } from './worktree-service';

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function initRepo(dir: string): Promise<void> {
  await git(['init'], dir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir);
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  await git(['commit', '--allow-empty', '-m', 'init'], dir);
}

async function worktreeCount(repoDir: string): Promise<number> {
  const out = await git(['worktree', 'list', '--porcelain'], repoDir);
  return out.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  return git(['rev-parse', '--verify', `refs/heads/${branch}`], repoDir).then(
    () => true,
    () => false
  );
}

describe('WorktreeService', () => {
  let repoDir: string;
  let poolDir: string;
  let host: WorktreeHost;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
    poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pool-'));
    await initRepo(repoDir);
    host = await LocalWorktreeHost.create({ allowedRoots: [repoDir, poolDir] });
  });

  afterEach(async () => {
    await git(['worktree', 'prune'], repoDir).catch(() => {});
    removeDirSync(repoDir);
    removeDirSync(poolDir);
  });

  function makeService(worktreePoolPath = poolDir): WorktreeService {
    return new WorktreeService({
      worktreePoolPath,
      repoPath: repoDir,
      ctx: new LocalExecutionContext({ root: repoDir }),
      host,
    });
  }

  describe('checkoutNewBranch', () => {
    it('creates the branch at the start point, in <pool>/<slug>', async () => {
      const startPoint = await git(['rev-parse', 'HEAD'], repoDir);
      await git(['commit', '--allow-empty', '-m', 'later'], repoDir);

      const result = await makeService().checkoutNewBranch({
        branchName: 'chord/fix-login-a1b',
        slug: 'fix-login-a1b',
        startPoint,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toBe(path.join(poolDir, 'fix-login-a1b'));
      expect(await git(['rev-parse', 'HEAD'], result.data)).toBe(startPoint);
      expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], result.data)).toBe(
        'chord/fix-login-a1b'
      );
      // The root checkout is never touched.
      expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir)).toBe('main');
    });

    it('refuses a branch name that already exists', async () => {
      await git(['branch', 'chord/taken'], repoDir);

      const result = await makeService().checkoutNewBranch({
        branchName: 'chord/taken',
        slug: 'taken',
        startPoint: 'main',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.type).toBe('branch-exists');
    });

    it('leaves no branch behind when the checkout cannot be created', async () => {
      // A file where the pool directory should be makes `worktree add` fail.
      const blockedPool = path.join(poolDir, 'blocked');
      fs.writeFileSync(blockedPool, 'not a directory');

      const result = await makeService(blockedPool).checkoutNewBranch({
        branchName: 'chord/doomed',
        slug: 'doomed',
        startPoint: 'main',
      });

      expect(result.success).toBe(false);
      expect(await branchExists(repoDir, 'chord/doomed')).toBe(false);
      expect(await worktreeCount(repoDir)).toBe(1);
    });
  });

  describe('checkoutExistingBranch', () => {
    it('refuses the branch the root checkout is on, and creates nothing', async () => {
      const result = await makeService().checkoutExistingBranch({
        branchName: 'main',
        slug: 'main',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatchObject({ type: 'branch-checked-out', branch: 'main' });
      if (result.error.type !== 'branch-checked-out') return;
      expect(fs.realpathSync(result.error.path)).toBe(fs.realpathSync(repoDir));
      expect(await worktreeCount(repoDir)).toBe(1);
      expect(fs.readdirSync(poolDir)).toEqual([]);
    });

    it('refuses a branch already checked out in another worktree', async () => {
      await git(['branch', 'feature/open'], repoDir);
      const elsewhere = path.join(poolDir, 'elsewhere');
      await git(['worktree', 'add', elsewhere, 'feature/open'], repoDir);

      const result = await makeService().checkoutExistingBranch({
        branchName: 'feature/open',
        slug: 'feature-open',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.type).toBe('branch-checked-out');
    });

    it('checks out a local branch that is not checked out anywhere', async () => {
      await git(['branch', 'feature/free'], repoDir);

      const result = await makeService().checkoutExistingBranch({
        branchName: 'feature/free',
        slug: 'feature-free',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toBe(path.join(poolDir, 'feature-free'));
      expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], result.data)).toBe('feature/free');
    });

    it('creates a tracking branch from the remote when it is not local', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remote-'));
      try {
        await git(['init', '--bare'], remoteDir);
        await git(['remote', 'add', 'origin', remoteDir], repoDir);
        await git(['branch', 'feature/from-remote'], repoDir);
        await git(['push', '-u', 'origin', 'feature/from-remote'], repoDir);
        await git(['branch', '-D', 'feature/from-remote'], repoDir);

        const result = await makeService().checkoutExistingBranch({
          branchName: 'feature/from-remote',
          slug: 'feature-from-remote',
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], result.data)).toBe(
          'feature/from-remote'
        );
      } finally {
        removeDirSync(remoteDir);
      }
    });

    it('reports a branch that exists nowhere', async () => {
      const result = await makeService().checkoutExistingBranch({
        branchName: 'feature/ghost',
        slug: 'feature-ghost',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.type).toBe('branch-not-found');
    });
  });
});
