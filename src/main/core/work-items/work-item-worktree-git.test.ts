import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { buildWorkItemBranchName, removeWorkItemWorktree } from './work-item-worktree-git';

async function git(args: string[], cwd: string): Promise<string> {
  const ctx = new LocalExecutionContext({ root: cwd });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function initRepo(dir: string): Promise<void> {
  await git(['init'], dir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir);
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  await git(['commit', '--allow-empty', '-m', 'init'], dir);
}

async function localBranches(repoDir: string): Promise<string[]> {
  const out = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repoDir);
  return out.split('\n').filter(Boolean);
}

describe('buildWorkItemBranchName', () => {
  it('matches the shape the settings UI previews to the user', () => {
    // RepositorySettingsCard shows `${branchPrefix}/my-feature-a3f`.
    expect(
      buildWorkItemBranchName({
        name: 'My Feature',
        workItemId: 'a3f9c2d1-0000-4000-8000-000000000000',
        branchPrefix: 'chord',
      })
    ).toBe('chord/my-feature-a3f');
  });

  it('omits the separator when the user has cleared the prefix', () => {
    expect(
      buildWorkItemBranchName({ name: 'My Feature', workItemId: 'a3f9c2d1', branchPrefix: '' })
    ).toBe('my-feature-a3f');
  });

  it('distinguishes two work items that share a name', () => {
    const first = buildWorkItemBranchName({
      name: 'Same Name',
      workItemId: 'aaa11111',
      branchPrefix: 'chord',
    });
    const second = buildWorkItemBranchName({
      name: 'Same Name',
      workItemId: 'bbb22222',
      branchPrefix: 'chord',
    });
    expect(first).not.toBe(second);
  });

  it('produces a name git accepts as a real branch', async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-branch-'));
    try {
      await initRepo(repoDir);
      const branchName = buildWorkItemBranchName({
        name: 'fix: crash on ~HEAD^ [urgent]?',
        workItemId: 'a3f9c2d1',
        branchPrefix: 'chord',
      });
      await git(['branch', branchName], repoDir);
      expect(await localBranches(repoDir)).toContain(branchName);
    } finally {
      removeDirSync(repoDir);
    }
  });
});

describe('removeWorkItemWorktree', () => {
  let repoDir: string;
  let poolDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-repo-'));
    poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-pool-'));
    await initRepo(repoDir);
  });

  afterEach(() => {
    removeDirSync(repoDir);
    removeDirSync(poolDir);
  });

  it('removes the worktree directory but keeps the branch', async () => {
    const worktreePath = path.join(poolDir, 'feature-a3f');
    await git(['worktree', 'add', worktreePath, '-b', 'chord/feature-a3f'], repoDir);
    expect(fs.existsSync(worktreePath)).toBe(true);

    await removeWorkItemWorktree(worktreePath);

    expect(fs.existsSync(worktreePath)).toBe(false);
    // The decision this encodes: deleting a work item must never destroy commits.
    expect(await localBranches(repoDir)).toContain('chord/feature-a3f');
  });

  it('removes a worktree that has uncommitted changes', async () => {
    const worktreePath = path.join(poolDir, 'dirty-b4c');
    await git(['worktree', 'add', worktreePath, '-b', 'chord/dirty-b4c'], repoDir);
    fs.writeFileSync(path.join(worktreePath, 'scratch.txt'), 'uncommitted');

    await removeWorkItemWorktree(worktreePath);

    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it('leaves a main checkout untouched', async () => {
    // Work items created before worktrees shipped still hold the repo root as
    // their repoPath. Deleting one must not remove the user's repository.
    await removeWorkItemWorktree(repoDir);

    expect(fs.existsSync(repoDir)).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(true);
    expect(await localBranches(repoDir)).toContain('main');
  });

  it('is a no-op for a path that is not a git checkout at all', async () => {
    const plainDir = path.join(poolDir, 'not-a-repo');
    fs.mkdirSync(plainDir);

    await expect(removeWorkItemWorktree(plainDir)).resolves.toBeUndefined();
    expect(fs.existsSync(plainDir)).toBe(true);
  });
});
