import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readWorktreeBranchState, readWorktreeChangeSummary } from './worktree-change-summary';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' }).trim();
}

function commitFile(repo: string, file: string, lines: number, message: string): void {
  const body = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');
  fs.writeFileSync(path.join(repo, file), `${body}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

function configure(repo: string): void {
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Chord Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
}

/**
 * A lane whose checkout folder was deleted outside Chord, or that git refuses,
 * is a typed state of that lane alone — `unreadable`, with the reason the
 * sidebar shows on hover — while every other lane is counted as usual.
 */
describe('readWorktreeChangeSummary', () => {
  let root: string;
  let clone: string;
  let kept: string;
  let deleted: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-change-summary-'));
    const upstream = path.join(root, 'upstream');
    clone = path.join(root, 'clone');
    kept = path.join(root, 'kept');
    deleted = path.join(root, 'deleted');
    fs.mkdirSync(upstream);
    git(upstream, 'init', '-q', '-b', 'main');
    configure(upstream);
    commitFile(upstream, 'base.txt', 1, 'base');
    git(root, 'clone', '-q', upstream, clone);
    configure(clone);

    git(clone, 'worktree', 'add', '-q', '--no-track', '-b', 'chord/kept', kept, 'origin/main');
    commitFile(kept, 'kept.txt', 3, 'kept work');
    git(
      clone,
      'worktree',
      'add',
      '-q',
      '--no-track',
      '-b',
      'chord/deleted',
      deleted,
      'origin/main'
    );
    commitFile(deleted, 'deleted.txt', 4, 'deleted work');
    removeDirSync(deleted);
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it('reports a lane whose checkout folder was deleted as unreadable, with no +/−', async () => {
    const branch = await readWorktreeBranchState(deleted);
    expect(branch.kind).toBe('unreadable');
    if (branch.kind !== 'unreadable') return;
    expect(branch.message).toContain(deleted);
    expect(branch.message).toContain('missing');

    const summary = await readWorktreeChangeSummary(
      { path: deleted, branchName: 'chord/deleted', targetRef: 'origin/main' },
      branch,
      'repoDefault'
    );

    expect(summary).toEqual({ compareBase: branch, diffStats: null });
  });

  it('still counts the other lane against its target', async () => {
    const branch = await readWorktreeBranchState(kept);

    const summary = await readWorktreeChangeSummary(
      { path: kept, branchName: 'chord/kept', targetRef: 'origin/main' },
      branch,
      'repoDefault'
    );

    expect(summary).toEqual({
      compareBase: { kind: 'ref', mode: 'repoDefault', ref: 'origin/main' },
      diffStats: { added: 3, removed: 0 },
    });
  });

  it('reports a folder git refuses as unreadable, with git’s reason', async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-not-a-repo-'));
    try {
      const branch = await readWorktreeBranchState(notARepo);

      expect(branch.kind).toBe('unreadable');
      if (branch.kind !== 'unreadable') return;
      expect(branch.message.startsWith(`Git could not read ${notARepo}`)).toBe(true);
    } finally {
      removeDirSync(notARepo);
    }
  });
});
