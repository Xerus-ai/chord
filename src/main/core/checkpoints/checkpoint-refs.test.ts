import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  captureCheckpointCommit,
  CHECKPOINT_REF_PREFIX,
  deleteCheckpointRefs,
} from './checkpoint-git';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function listCheckpointRefs(repo: string): string[] {
  return git(repo, 'for-each-ref', '--format=%(refname)', 'refs/chord/checkpoints/')
    .split('\n')
    .filter(Boolean);
}

describe('deleteCheckpointRefs', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-ckpt-refs-'));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Chord Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('releases the refs it is given and leaves the rest of the repo alone', async () => {
    const first = await captureCheckpointCommit(repo, 'ck-a', 'Checkpoint: a');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
    const second = await captureCheckpointCommit(repo, 'ck-b', 'Checkpoint: b');
    const other = await captureCheckpointCommit(repo, 'ck-other-item', 'Checkpoint: other');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(other).not.toBeNull();
    expect(listCheckpointRefs(repo)).toHaveLength(3);

    await deleteCheckpointRefs(repo, [
      `${CHECKPOINT_REF_PREFIX}ck-a`,
      `${CHECKPOINT_REF_PREFIX}ck-b`,
    ]);

    expect(listCheckpointRefs(repo)).toEqual([`${CHECKPOINT_REF_PREFIX}ck-other-item`]);
    // The surviving checkpoint still resolves, and HEAD is untouched.
    expect(git(repo, 'rev-parse', `${CHECKPOINT_REF_PREFIX}ck-other-item`).trim()).toBe(
      other!.commitSha
    );
    expect(git(repo, 'status', '--porcelain')).toContain('a.txt');
  });

  it('treats an already-collected ref as nothing left to do', async () => {
    await captureCheckpointCommit(repo, 'ck-gone', 'Checkpoint: gone');
    git(repo, 'update-ref', '-d', `${CHECKPOINT_REF_PREFIX}ck-gone`);

    await expect(
      deleteCheckpointRefs(repo, [`${CHECKPOINT_REF_PREFIX}ck-gone`])
    ).resolves.toBeUndefined();
    expect(listCheckpointRefs(repo)).toEqual([]);
  });

  it('refuses to delete a ref outside the checkpoint namespace', async () => {
    await expect(deleteCheckpointRefs(repo, ['refs/heads/main'])).rejects.toThrow(
      /non-checkpoint ref/
    );
    expect(git(repo, 'rev-parse', '--verify', 'refs/heads/main').trim()).toHaveLength(40);
  });
});
