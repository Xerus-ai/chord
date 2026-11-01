import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { discardWorkItemFileChanges, getStagedPaths, revertWorkItemFile } from './file-revert';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function write(dir: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

describe('file-revert', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-file-revert-'));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Chord Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    write(repo, 'a.txt', 'a-head');
    write(repo, 'nested/b.txt', 'b-head');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  describe('getStagedPaths', () => {
    it('returns only files with staged changes', async () => {
      write(repo, 'a.txt', 'staged');
      git(repo, 'add', 'a.txt');
      write(repo, 'nested/b.txt', 'unstaged only');
      write(repo, 'c.txt', 'untracked');

      const staged = await getStagedPaths(repo);
      expect(staged).toEqual(new Set(['a.txt']));
    });

    it('returns an empty set for a clean repo', async () => {
      expect(await getStagedPaths(repo)).toEqual(new Set());
    });
  });

  describe('revertWorkItemFile', () => {
    it('restores an unstaged tracked file to its HEAD content', async () => {
      write(repo, 'a.txt', 'modified');

      await revertWorkItemFile(repo, 'a.txt');

      expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a-head');
      expect(git(repo, 'status', '--porcelain').trim()).toBe('');
    });

    it('deletes an untracked file', async () => {
      write(repo, 'c.txt', 'untracked');

      await revertWorkItemFile(repo, 'c.txt');

      expect(fs.existsSync(path.join(repo, 'c.txt'))).toBe(false);
    });

    it('rejects a file with staged changes and leaves it untouched', async () => {
      write(repo, 'a.txt', 'staged edit');
      git(repo, 'add', 'a.txt');

      await expect(revertWorkItemFile(repo, 'a.txt')).rejects.toThrow(/staged/);
      expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('staged edit');
    });

    it('rejects a file with mixed staged and unstaged changes', async () => {
      write(repo, 'a.txt', 'staged edit');
      git(repo, 'add', 'a.txt');
      write(repo, 'a.txt', 'further unstaged edit');

      await expect(revertWorkItemFile(repo, 'a.txt')).rejects.toThrow(/staged/);
      expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('further unstaged edit');
    });

    it('reverts nested paths', async () => {
      write(repo, 'nested/b.txt', 'modified');

      await revertWorkItemFile(repo, 'nested/b.txt');

      expect(fs.readFileSync(path.join(repo, 'nested', 'b.txt'), 'utf8')).toBe('b-head');
    });

    it('rejects paths escaping the repo root', async () => {
      await expect(revertWorkItemFile(repo, '../outside.txt')).rejects.toThrow(/outside/);
      await expect(revertWorkItemFile(repo, path.resolve(repo, '..', 'x.txt'))).rejects.toThrow(
        /outside/
      );
    });
  });

  describe('discardWorkItemFileChanges', () => {
    it('restores a tracked file whose change is already staged', async () => {
      write(repo, 'a.txt', 'staged edit');
      git(repo, 'add', 'a.txt');

      await discardWorkItemFileChanges(repo, 'a.txt');

      expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a-head');
      expect(git(repo, 'status', '--porcelain').trim()).toBe('');
    });

    it('restores a tracked file with mixed staged and unstaged changes', async () => {
      write(repo, 'nested/b.txt', 'staged edit');
      git(repo, 'add', 'nested/b.txt');
      write(repo, 'nested/b.txt', 'further unstaged edit');

      await discardWorkItemFileChanges(repo, 'nested/b.txt');

      expect(fs.readFileSync(path.join(repo, 'nested', 'b.txt'), 'utf8')).toBe('b-head');
      expect(git(repo, 'status', '--porcelain').trim()).toBe('');
    });

    it('unstages and deletes a newly added file absent from HEAD', async () => {
      write(repo, 'c.txt', 'new file');
      git(repo, 'add', 'c.txt');

      await discardWorkItemFileChanges(repo, 'c.txt');

      expect(fs.existsSync(path.join(repo, 'c.txt'))).toBe(false);
      expect(git(repo, 'status', '--porcelain').trim()).toBe('');
    });

    it('deletes an untracked file', async () => {
      write(repo, 'c.txt', 'untracked');

      await discardWorkItemFileChanges(repo, 'c.txt');

      expect(fs.existsSync(path.join(repo, 'c.txt'))).toBe(false);
    });

    it('restores a file deleted from the worktree', async () => {
      fs.rmSync(path.join(repo, 'a.txt'));

      await discardWorkItemFileChanges(repo, 'a.txt');

      expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a-head');
    });

    it('rejects paths escaping the repo root', async () => {
      await expect(discardWorkItemFileChanges(repo, '../outside.txt')).rejects.toThrow(/outside/);
    });
  });
});
