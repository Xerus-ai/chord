import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { captureCheckpointCommit, restoreCheckpointCommit } from './checkpoint-git';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function initRepo(dir: string): void {
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Chord Test');
  // Snapshot commits must not depend on the host's signing setup.
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function write(dir: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

describe('captureCheckpointCommit', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-ckpt-'));
    initRepo(repo);
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('returns null for a repo with no commits', async () => {
    write(repo, 'a.txt', 'hello');
    const result = await captureCheckpointCommit(repo, 'ck-empty', 'Checkpoint: empty');
    expect(result).toBeNull();
  });

  it('snapshots tracked modifications and untracked files into a commit parented on HEAD', async () => {
    write(repo, 'a.txt', 'v1');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');
    const headSha = git(repo, 'rev-parse', 'HEAD').trim();

    write(repo, 'a.txt', 'v2');
    write(repo, 'new/c.txt', 'untracked content');

    const result = await captureCheckpointCommit(repo, 'ck-1', 'Checkpoint: turn ck-1');
    expect(result).not.toBeNull();
    expect(result!.branchName).toBe('main');

    // Commit is parented on HEAD and holds both the modified and untracked file.
    expect(git(repo, 'rev-parse', `${result!.commitSha}^`).trim()).toBe(headSha);
    expect(git(repo, 'show', `${result!.commitSha}:a.txt`)).toBe('v2');
    expect(git(repo, 'show', `${result!.commitSha}:new/c.txt`)).toBe('untracked content');

    // The ref anchors the commit against GC.
    expect(git(repo, 'rev-parse', 'refs/chord/checkpoints/ck-1').trim()).toBe(result!.commitSha);
  });

  it('does not disturb the user index, worktree, or status', async () => {
    write(repo, 'a.txt', 'v1');
    write(repo, 'b.txt', 'v1');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    // Mixed state: one staged edit, one unstaged edit, one untracked file.
    write(repo, 'a.txt', 'staged edit');
    git(repo, 'add', 'a.txt');
    write(repo, 'b.txt', 'unstaged edit');
    write(repo, 'c.txt', 'untracked');

    const statusBefore = git(repo, 'status', '--porcelain');
    const indexBefore = git(repo, 'write-tree');

    await captureCheckpointCommit(repo, 'ck-2', 'Checkpoint: turn ck-2');

    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore);
    expect(git(repo, 'write-tree')).toBe(indexBefore);
    expect(read(repo, 'a.txt')).toBe('staged edit');
    expect(read(repo, 'b.txt')).toBe('unstaged edit');
    expect(read(repo, 'c.txt')).toBe('untracked');
  });

  it('excludes gitignored files from the snapshot', async () => {
    write(repo, '.gitignore', 'secret.env\n');
    write(repo, 'a.txt', 'v1');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    write(repo, 'secret.env', 'TOKEN=abc');
    const result = await captureCheckpointCommit(repo, 'ck-3', 'Checkpoint: turn ck-3');

    const treeFiles = git(repo, 'ls-tree', '-r', '--name-only', result!.commitSha);
    expect(treeFiles).not.toContain('secret.env');
  });
});

describe('restoreCheckpointCommit', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-ckpt-restore-'));
    initRepo(repo);
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('restores modified, deleted, and untracked files and removes files created after the checkpoint', async () => {
    write(repo, 'a.txt', 'a-base');
    write(repo, 'b.txt', 'b-base');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    write(repo, 'a.txt', 'a-at-checkpoint');
    write(repo, 'c.txt', 'c-at-checkpoint');
    const checkpoint = await captureCheckpointCommit(repo, 'ck-r1', 'Checkpoint');
    expect(checkpoint).not.toBeNull();

    // Diverge after the checkpoint: edit, delete, create.
    write(repo, 'a.txt', 'a-after');
    fs.rmSync(path.join(repo, 'b.txt'));
    fs.rmSync(path.join(repo, 'c.txt'));
    write(repo, 'd.txt', 'd-after');

    await restoreCheckpointCommit(repo, checkpoint!.commitSha);

    expect(read(repo, 'a.txt')).toBe('a-at-checkpoint');
    expect(read(repo, 'b.txt')).toBe('b-base');
    expect(read(repo, 'c.txt')).toBe('c-at-checkpoint');
    expect(fs.existsSync(path.join(repo, 'd.txt'))).toBe(false);

    // Index is left coherent: nothing staged, deltas vs HEAD show as unstaged.
    expect(git(repo, 'diff', '--name-only', '--cached').trim()).toBe('');
    const unstaged = git(repo, 'diff', '--name-only').trim().split('\n');
    expect(unstaged).toContain('a.txt');
  });

  it('does not delete gitignored files present in the worktree', async () => {
    write(repo, '.gitignore', 'secret.env\n');
    write(repo, 'a.txt', 'v1');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    const checkpoint = await captureCheckpointCommit(repo, 'ck-r2', 'Checkpoint');
    write(repo, 'secret.env', 'TOKEN=abc');

    await restoreCheckpointCommit(repo, checkpoint!.commitSha);

    expect(read(repo, 'secret.env')).toBe('TOKEN=abc');
  });

  it('restores checkpoint content even after HEAD has advanced', async () => {
    write(repo, 'a.txt', 'a-base');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    write(repo, 'a.txt', 'a-at-checkpoint');
    const checkpoint = await captureCheckpointCommit(repo, 'ck-r3', 'Checkpoint');

    // User commits different content afterwards — HEAD moves past the snapshot parent.
    write(repo, 'a.txt', 'a-committed-later');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'later');

    await restoreCheckpointCommit(repo, checkpoint!.commitSha);

    expect(read(repo, 'a.txt')).toBe('a-at-checkpoint');
  });
});
