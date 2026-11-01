import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolveWorkItemBranchInfo } from './resolve-branch-info';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function initRepo(dir: string, branch: string): void {
  git(dir, 'init', '-b', branch);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Chord Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function commit(dir: string, content: string): string {
  fs.writeFileSync(path.join(dir, 'a.txt'), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', content);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

describe('resolveWorkItemBranchInfo', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-branch-info-'));
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('names the branch of a repo with no commits yet', async () => {
    initRepo(repo, 'main');
    expect(await resolveWorkItemBranchInfo(repo)).toEqual({
      currentBranch: 'main',
      defaultBranch: 'main',
    });
  });

  it('prefers the remote default over the conventional names', async () => {
    initRepo(repo, 'feature/x');
    commit(repo, 'base');
    git(repo, 'branch', 'main');
    // What a clone with a `trunk` default looks like locally.
    git(repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');

    expect(await resolveWorkItemBranchInfo(repo)).toEqual({
      currentBranch: 'feature/x',
      defaultBranch: 'trunk',
    });
  });

  it('falls back to master when there is no origin/HEAD and no main', async () => {
    initRepo(repo, 'master');
    commit(repo, 'base');
    git(repo, 'checkout', '-b', 'work');

    expect(await resolveWorkItemBranchInfo(repo)).toEqual({
      currentBranch: 'work',
      defaultBranch: 'master',
    });
  });

  it('reports a detached HEAD as no current branch', async () => {
    initRepo(repo, 'main');
    const sha = commit(repo, 'base');
    git(repo, 'checkout', '--detach', sha);

    expect(await resolveWorkItemBranchInfo(repo)).toEqual({
      currentBranch: null,
      defaultBranch: 'main',
    });
  });

  it('throws for a path that is not a repository instead of guessing "main"', async () => {
    await expect(resolveWorkItemBranchInfo(repo)).rejects.toThrow();
  });
});
