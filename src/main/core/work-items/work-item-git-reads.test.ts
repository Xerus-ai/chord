import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readChangedFiles, readFileDiff, readRepoFileList } from './work-item-git-reads';

/** Non-ASCII on both a directory and a file component. */
const UNICODE_PATH = 'café/naïve-ünïcode.txt';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function initRepo(dir: string): void {
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Chord Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function write(dir: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

describe('readChangedFiles', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-git-reads-'));
    initRepo(repo);
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('reports non-ASCII paths verbatim instead of octal-escaped', async () => {
    write(repo, UNICODE_PATH, 'v1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    write(repo, UNICODE_PATH, 'v2\n');
    write(repo, 'ünträcked-ファイル.txt', 'new\n');

    const files = await readChangedFiles(repo);
    const names = files.map((file) => file.name);

    expect(names).toContain(UNICODE_PATH);
    expect(names).toContain('ünträcked-ファイル.txt');
    // git's default quoting would have produced "caf\303\251/..." wrapped in quotes.
    expect(names.some((name) => name.includes('\\3') || name.startsWith('"'))).toBe(false);

    const changed = files.find((file) => file.name === UNICODE_PATH)!;
    expect(changed.added).toBe(1);
    expect(changed.removed).toBe(1);
  });

  it('splits a rename into the two real paths rather than an "old => new" row', async () => {
    write(repo, 'original.txt', 'one\ntwo\nthree\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    git(repo, 'mv', 'original.txt', 'renamed.txt');

    const files = await readChangedFiles(repo);
    const byName = new Map(files.map((file) => [file.name, file]));

    expect(byName.has('original.txt')).toBe(true);
    expect(byName.has('renamed.txt')).toBe(true);
    expect(files.some((file) => file.name.includes('=>'))).toBe(false);

    // The removed side loses every line, the added side gains them back —
    // never the unusable `-` counts a rename row carries.
    expect(byName.get('original.txt')).toMatchObject({ added: 0, removed: 3 });
    expect(byName.get('renamed.txt')).toMatchObject({ added: 3, removed: 0 });

    // `git mv` stages both sides, so neither is one-click revertable.
    expect(byName.get('original.txt')!.staged).toBe(true);
    expect(byName.get('renamed.txt')!.staged).toBe(true);
  });

  it('marks only files whose index entry differs from HEAD as staged', async () => {
    write(repo, 'a.txt', 'v1\n');
    write(repo, 'b.txt', 'v1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    write(repo, 'a.txt', 'staged\n');
    git(repo, 'add', 'a.txt');
    write(repo, 'b.txt', 'unstaged\n');

    const byName = new Map((await readChangedFiles(repo)).map((file) => [file.name, file]));
    expect(byName.get('a.txt')!.staged).toBe(true);
    expect(byName.get('b.txt')!.staged).toBe(false);
  });

  // devstation-ui4: a new file is all additions, as git counts it once added
  // — a new folder listed file by file, a binary counted as nothing.
  it('counts the lines of each untracked file, and none for a binary', async () => {
    write(repo, 'base.txt', 'base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    write(repo, 'notes.md', 'one\ntwo\nthree\n');
    write(repo, 'new dir/no-newline.txt', 'a\nb');
    fs.writeFileSync(path.join(repo, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x0a, 0x01]));

    const byName = new Map((await readChangedFiles(repo)).map((file) => [file.name, file]));
    expect(byName.get('notes.md')).toMatchObject({ added: 3, removed: 0 });
    expect(byName.get('new dir/no-newline.txt')).toMatchObject({ added: 2, removed: 0 });
    expect(byName.get('image.bin')).toMatchObject({ added: 0, removed: 0 });
  });

  it('propagates a git failure instead of reporting an unchanged worktree', async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-not-a-repo-'));
    try {
      await expect(readChangedFiles(notARepo)).rejects.toThrow();
    } finally {
      removeDirSync(notARepo);
    }
  });
});

describe('readRepoFileList', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-git-list-'));
    initRepo(repo);
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('lists tracked and untracked non-ASCII paths verbatim, skipping ignored ones', async () => {
    write(repo, '.gitignore', 'ignored.txt\n');
    write(repo, UNICODE_PATH, 'tracked\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');

    write(repo, 'ignored.txt', 'secret\n');
    write(repo, 'süddeutsche.md', 'untracked\n');

    const files = await readRepoFileList(repo);
    expect(files).toContain(UNICODE_PATH);
    expect(files).toContain('süddeutsche.md');
    expect(files).not.toContain('ignored.txt');
  });
});

describe('readFileDiff', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-git-diff-'));
    initRepo(repo);
    write(repo, 'base.txt', 'base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('returns an empty original for a file that is not in HEAD', async () => {
    write(repo, 'brand-new.txt', 'added\n');
    expect(await readFileDiff(repo, 'brand-new.txt')).toEqual({
      original: '',
      modified: 'added\n',
    });
  });

  it('returns an empty modified side for a deleted file', async () => {
    fs.rmSync(path.join(repo, 'base.txt'));
    expect(await readFileDiff(repo, 'base.txt')).toEqual({ original: 'base\n', modified: '' });
  });

  it('reads both sides of a non-ASCII path', async () => {
    write(repo, UNICODE_PATH, 'original\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'unicode');
    write(repo, UNICODE_PATH, 'edited\n');

    expect(await readFileDiff(repo, UNICODE_PATH)).toEqual({
      original: 'original\n',
      modified: 'edited\n',
    });
  });
});
