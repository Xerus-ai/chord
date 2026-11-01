import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { buildGitStateSnapshot, readGitStateInputs } from './git-state-snapshot';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function write(repo: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
}

/**
 * devstation-c4t: a teammate read "Not synced" on the owner's live item
 * because every capture threw `EISDIR` and pushed nothing — `git status
 * --porcelain` names a new untracked folder once, as `dir/`, and the snapshot
 * read that folder as a file. What the owner's Changes tab lists, file by
 * file, is what the snapshot carries.
 */
describe('buildGitStateSnapshot over readGitStateInputs', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-gitstate-'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Chord Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.autocrlf', 'false');
    write(repo, 'tracked.txt', 'one\n');
    write(repo, 'gone.txt', 'bye\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  async function capture() {
    const inputs = await readGitStateInputs(repo);
    return buildGitStateSnapshot(
      { workItemId: 'w', repoPath: repo },
      inputs.branch,
      inputs.porcelain,
      inputs.numstat,
      undefined
    );
  }

  it('lists each file of a new untracked folder, with its contents', async () => {
    write(repo, '.fixtures/deep/card.tsx', 'export const card = 1;\n');
    write(repo, '.fixtures/page.html', '<p>page</p>\n');

    const { body } = await capture();

    expect(body.branch_name).toBe('main');
    expect(body.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ['.fixtures/deep/card.tsx', 'added'],
      ['.fixtures/page.html', 'added'],
    ]);
    expect(body.contents.find((c) => c.path === '.fixtures/page.html')).toEqual({
      path: '.fixtures/page.html',
      original: '',
      modified: '<p>page</p>\n',
    });
  });

  it('reads paths with spaces as the paths they are', async () => {
    write(repo, 'notes with space.md', 'hello\n');
    write(repo, 'tracked.txt', 'one\ntwo\n');
    fs.rmSync(path.join(repo, 'gone.txt'));

    const { body } = await capture();

    expect(body.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ['gone.txt', 'deleted'],
      ['notes with space.md', 'added'],
      ['tracked.txt', 'modified'],
    ]);
    expect(body.contents.find((c) => c.path === 'notes with space.md')?.modified).toBe('hello\n');
    expect(body.files.find((f) => f.path === 'tracked.txt')).toMatchObject({
      additions: 1,
      deletions: 0,
    });
  });

  // devstation-ui4: the teammate's Changes showed a new file as +0, and a new
  // binary went out as utf-8 garbage that looked like a real diff.
  it('counts a new file’s lines, and omits a new binary’s contents', async () => {
    write(repo, 'notes.md', 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(repo, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x0a, 0x01]));

    const { body } = await capture();

    expect(body.files.find((f) => f.path === 'notes.md')).toMatchObject({
      status: 'added',
      additions: 3,
      deletions: 0,
    });
    expect(body.files.find((f) => f.path === 'image.bin')).toMatchObject({
      additions: 0,
      content_omitted: true,
    });
    expect(body.contents.map((c) => c.path)).toEqual(['notes.md']);
  });

  it('carries a staged rename as a delete and an add', async () => {
    git(repo, 'mv', 'tracked.txt', 'renamed.txt');

    const { body } = await capture();

    expect(body.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ['renamed.txt', 'added'],
      ['tracked.txt', 'deleted'],
    ]);
  });
});
