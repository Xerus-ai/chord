import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { fastForwardLocalBase } from './fast-forward-local-base';

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

/**
 * "Keep local base up to date": after a lane fetched `origin/main`, the
 * user's own `main` follows it — but only by fast-forward, and never under a
 * checkout that has it checked out (moving that ref would make its working
 * tree look edited).
 */
describe('fastForwardLocalBase', () => {
  let root: string;
  let upstream: string;
  let clone: string;

  async function commitUpstream(message: string): Promise<string> {
    const work = path.join(root, 'upstream-work');
    await git(['commit', '--allow-empty', '-m', message], work);
    await git(['push', 'origin', 'main'], work);
    return git(['rev-parse', 'HEAD'], work);
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-base-'));
    upstream = path.join(root, 'upstream.git');
    await git(['init', '--bare', upstream], root);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], upstream);

    const work = path.join(root, 'upstream-work');
    await git(['clone', upstream, work], root);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], work);
    await git(['config', 'user.email', 'test@test.com'], work);
    await git(['config', 'user.name', 'Test'], work);
    await git(['commit', '--allow-empty', '-m', 'init'], work);
    await git(['push', 'origin', 'main'], work);

    clone = path.join(root, 'clone');
    await git(['clone', upstream, clone], root);
    await git(['config', 'user.email', 'test@test.com'], clone);
    await git(['config', 'user.name', 'Test'], clone);
    // The user works on another branch in the main checkout.
    await git(['checkout', '-b', 'feature'], clone);
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it('moves the local branch up to the fetched remote branch', async () => {
    const newest = await commitUpstream('new on origin');
    await git(['fetch', 'origin'], clone);

    await expect(fastForwardLocalBase(clone, 'origin/main')).resolves.toBe('updated');
    expect(await git(['rev-parse', 'refs/heads/main'], clone)).toBe(newest);
  });

  it('reports it up to date when there is nothing to move', async () => {
    await expect(fastForwardLocalBase(clone, 'origin/main')).resolves.toBe('up_to_date');
  });

  it('leaves a branch that has commits of its own', async () => {
    await git(['checkout', 'main'], clone);
    await git(['commit', '--allow-empty', '-m', 'local only'], clone);
    const local = await git(['rev-parse', 'HEAD'], clone);
    await git(['checkout', 'feature'], clone);
    await commitUpstream('new on origin');
    await git(['fetch', 'origin'], clone);

    await expect(fastForwardLocalBase(clone, 'origin/main')).resolves.toBe('diverged');
    expect(await git(['rev-parse', 'refs/heads/main'], clone)).toBe(local);
  });

  it('leaves a branch that is checked out in a checkout', async () => {
    await git(['checkout', 'main'], clone);
    const before = await git(['rev-parse', 'HEAD'], clone);
    await commitUpstream('new on origin');
    await git(['fetch', 'origin'], clone);

    await expect(fastForwardLocalBase(clone, 'origin/main')).resolves.toBe('checked_out');
    expect(await git(['rev-parse', 'refs/heads/main'], clone)).toBe(before);
  });

  it('does nothing when there is no local branch of that name', async () => {
    await git(['branch', '-D', 'main'], clone);
    await commitUpstream('new on origin');
    await git(['fetch', 'origin'], clone);

    await expect(fastForwardLocalBase(clone, 'origin/main')).resolves.toBe('no_local_branch');
    expect(await git(['branch', '--list', 'main'], clone)).toBe('');
  });

  it('does nothing for a base that is not a remote branch', async () => {
    await expect(fastForwardLocalBase(clone, 'feature')).resolves.toBe('not_remote');
  });
});
