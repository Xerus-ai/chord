import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { inspectWorktreeGitState } from './archive-inspect';

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

describe('inspectWorktreeGitState', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-inspect-'));
    await initRepo(repoDir);
  });

  afterEach(() => {
    removeDirSync(repoDir);
  });

  it('reports a clean repo with no upstream as 0 uncommitted and null unpushed', async () => {
    expect(await inspectWorktreeGitState(repoDir)).toEqual({ uncommitted: 0, unpushed: null });
  });

  it('counts a dirty tracked file and an untracked file as two uncommitted entries', async () => {
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'x');
    await git(['add', 'README.md'], repoDir);
    await git(['commit', '-m', 'add readme'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'y');
    fs.writeFileSync(path.join(repoDir, 'scratch.txt'), 'z');

    const result = await inspectWorktreeGitState(repoDir);
    expect(result.uncommitted).toBe(2);
    expect(result.unpushed).toBeNull();
  });

  it('reports one unpushed commit for a linked worktree with an upstream', async () => {
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-inspect-remote-'));
    const poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-inspect-pool-'));
    try {
      await git(['init', '--bare'], remoteDir);
      await git(['remote', 'add', 'origin', remoteDir], repoDir);
      await git(['push', '-u', 'origin', 'main'], repoDir);

      const worktreePath = path.join(poolDir, 'feature');
      await git(['worktree', 'add', '-b', 'feature', worktreePath], repoDir);
      await git(['push', '-u', 'origin', 'feature'], worktreePath);

      fs.writeFileSync(path.join(worktreePath, 'new-file.txt'), 'content');
      await git(['add', 'new-file.txt'], worktreePath);
      await git(['commit', '-m', 'one local commit'], worktreePath);

      expect(await inspectWorktreeGitState(worktreePath)).toEqual({
        uncommitted: 0,
        unpushed: 1,
      });
    } finally {
      removeDirSync(remoteDir);
      removeDirSync(poolDir);
    }
  });
});
