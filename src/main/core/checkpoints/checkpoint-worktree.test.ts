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
  restoreCheckpointCommit,
} from './checkpoint-git';

/**
 * Checkpoint refs live under `refs/chord/checkpoints/` in the repo's shared
 * git object store, which every linked worktree of that repo shares. These
 * tests prove the two properties T0.10 depends on:
 *  - a capture + restore run against a linked worktree's path never touches
 *    files in the main (primary) checkout,
 *  - a ref deleted from the linked worktree's path is gone when looked up
 *    from the main checkout, since it is the same repo.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function write(dir: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

describe('checkpoints across linked worktrees', () => {
  let root: string;
  let main: string;
  let linked: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-ckpt-wt-'));
    main = path.join(root, 'main');
    fs.mkdirSync(main);
    git(main, 'init', '-b', 'main');
    git(main, 'config', 'user.email', 'test@example.com');
    git(main, 'config', 'user.name', 'Chord Test');
    git(main, 'config', 'commit.gpgsign', 'false');
    write(main, 'a.txt', 'base');
    git(main, 'add', '-A');
    git(main, 'commit', '-m', 'base');

    linked = path.join(root, 'linked');
    git(main, 'worktree', 'add', linked, '-b', 'secondary');
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it('captures and restores in the linked worktree without touching the primary checkout', async () => {
    // Diverge the linked worktree from the primary before checkpointing.
    write(linked, 'a.txt', 'linked-v1');
    write(linked, 'only-in-linked.txt', 'linked-only');

    const checkpoint = await captureCheckpointCommit(linked, 'ck-linked-1', 'Checkpoint: linked');
    expect(checkpoint).not.toBeNull();

    // The primary checkout is untouched by the capture.
    expect(read(main, 'a.txt')).toBe('base');
    expect(fs.existsSync(path.join(main, 'only-in-linked.txt'))).toBe(false);

    // Diverge further, then restore — only the linked checkout changes.
    write(linked, 'a.txt', 'linked-v2');
    fs.rmSync(path.join(linked, 'only-in-linked.txt'));

    await restoreCheckpointCommit(linked, checkpoint!.commitSha);

    expect(read(linked, 'a.txt')).toBe('linked-v1');
    expect(read(linked, 'only-in-linked.txt')).toBe('linked-only');
    // The primary checkout's own files were never touched by the restore.
    expect(read(main, 'a.txt')).toBe('base');
    expect(fs.existsSync(path.join(main, 'only-in-linked.txt'))).toBe(false);
  });

  it('releases a ref from the linked worktree path and the ref is gone from the main checkout too', async () => {
    write(linked, 'a.txt', 'linked-edit');
    const checkpoint = await captureCheckpointCommit(linked, 'ck-linked-2', 'Checkpoint: linked');
    expect(checkpoint).not.toBeNull();

    // Visible from the main checkout: refs live in the shared object store.
    expect(git(main, 'rev-parse', `${CHECKPOINT_REF_PREFIX}ck-linked-2`).trim()).toBe(
      checkpoint!.commitSha
    );

    await deleteCheckpointRefs(linked, [`${CHECKPOINT_REF_PREFIX}ck-linked-2`]);

    expect(() =>
      git(main, 'rev-parse', '--verify', `${CHECKPOINT_REF_PREFIX}ck-linked-2`)
    ).toThrow();
    expect(() =>
      git(linked, 'rev-parse', '--verify', `${CHECKPOINT_REF_PREFIX}ck-linked-2`)
    ).toThrow();
  });
});
