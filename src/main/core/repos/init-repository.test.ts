import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { initGitRepository, isGitRepo } from './init-repository';

async function git(args: string[], cwd: string): Promise<string> {
  const ctx = new LocalExecutionContext({ root: cwd });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

describe('initGitRepository', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-init-'));
  });

  afterEach(() => {
    removeDirSync(dir);
  });

  it('turns a plain folder into a git repository', async () => {
    expect(await isGitRepo(dir)).toBe(false);

    const result = await initGitRepository(dir);

    expect(result.success).toBe(true);
    expect(await isGitRepo(dir)).toBe(true);
  });

  it('leaves HEAD on a branch that actually resolves', async () => {
    // The reason the initial commit exists. A fresh `git init` reports a branch
    // name from --abbrev-ref while refs/heads/<name> does not yet exist.
    await initGitRepository(dir);

    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
    expect(branch).not.toBe('HEAD');
    await expect(git(['rev-parse', '--verify', `refs/heads/${branch}`], dir)).resolves.toBeTruthy();
  });

  it('produces a repository a work item worktree can immediately branch from', async () => {
    // The integration this guards: provisioning branches the new worktree from
    // the repo's current branch. Without the initial commit this is exactly
    // where a brand-new repository would fail, reported as branch-not-found.
    await initGitRepository(dir);
    const poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-init-pool-'));

    try {
      const worktreePath = path.join(poolDir, 'first-work-item');
      await git(['worktree', 'add', worktreePath, '-b', 'chord/first-a1b'], dir);

      expect(fs.existsSync(path.join(worktreePath, '.git'))).toBe(true);
    } finally {
      removeDirSync(poolDir);
    }
  });

  it('refuses a folder that is already a repository rather than reinitialising it', async () => {
    await initGitRepository(dir);

    const second = await initGitRepository(dir);

    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.type).toBe('already_git_repo');
  });

  it('does not report a plain folder as a repository', async () => {
    expect(await isGitRepo(dir)).toBe(false);
  });
});
