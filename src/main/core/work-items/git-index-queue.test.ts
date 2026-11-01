import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureCheckpointCommit,
  restoreCheckpointCommit,
} from '@main/core/checkpoints/checkpoint-git';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { discardWorkItemFileChanges, stageWorkItemFile } from './file-revert';
import { enqueueRepoIndexOp } from './git-index-queue';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

describe('enqueueRepoIndexOp', () => {
  it('never lets two operations on the same repo overlap', async () => {
    const events: string[] = [];
    const op = (name: string, delayMs: number) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`${name}:end`);
    };

    await Promise.all([
      enqueueRepoIndexOp('/repo-one', op('a', 20)),
      enqueueRepoIndexOp('/repo-one', op('b', 1)),
      enqueueRepoIndexOp('/repo-one', op('c', 1)),
    ]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('keeps draining after an operation rejects', async () => {
    const failure = enqueueRepoIndexOp('/repo-two', () =>
      Promise.reject(new Error('index write failed'))
    );
    const after = enqueueRepoIndexOp('/repo-two', () => Promise.resolve('ran anyway'));

    await expect(failure).rejects.toThrow('index write failed');
    await expect(after).resolves.toBe('ran anyway');
  });

  it('runs operations on different repos concurrently', async () => {
    let firstStarted = false;
    let secondSawFirstRunning = false;

    await Promise.all([
      enqueueRepoIndexOp('/repo-three', async () => {
        firstStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }),
      enqueueRepoIndexOp('/repo-four', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        secondSawFirstRunning = firstStarted;
      }),
    ]);

    expect(secondSawFirstRunning).toBe(true);
  });
});

describe('concurrent index writers on one repo', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-index-race-'));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Chord Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      fs.writeFileSync(path.join(repo, name), 'base\n');
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'base');
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('runs a checkpoint revert, a stage and a discard together without an index.lock collision', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'at-checkpoint\n');
    const checkpoint = await captureCheckpointCommit(repo, 'ck-race', 'Checkpoint: race');
    expect(checkpoint).not.toBeNull();

    fs.writeFileSync(path.join(repo, 'a.txt'), 'after\n');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'edited\n');
    fs.writeFileSync(path.join(repo, 'c.txt'), 'edited\n');

    // All three take the repo's index lock; unserialized, at least one dies
    // with "Unable to create '.../index.lock': File exists".
    await Promise.all([
      restoreCheckpointCommit(repo, checkpoint!.commitSha),
      stageWorkItemFile(repo, 'b.txt'),
      discardWorkItemFileChanges(repo, 'c.txt'),
      captureCheckpointCommit(repo, 'ck-race-2', 'Checkpoint: race 2'),
    ]);

    // Every operation landed and the repo is left coherent. Line endings are
    // whatever the host's autocrlf setting produced, so compare the content.
    const read = (file: string) => fs.readFileSync(path.join(repo, file), 'utf8').trim();
    expect(read('a.txt')).toBe('at-checkpoint');
    expect(read('c.txt')).toBe('base');
    expect(fs.existsSync(path.join(repo, '.git', 'index.lock'))).toBe(false);
  });
});
