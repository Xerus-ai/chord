import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalWorktreeHost } from '@main/core/projects/worktrees/hosts/local-worktree-host';
import { WorktreeService } from '@main/core/projects/worktrees/worktree-service';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { createRemoteTrackingBranch } from './remote-tracking-branch';

/**
 * A branch picked from any remote in Create from… (plan §Phase 3 slice 2)
 * becomes a local branch tracking `<remote>/<branch>` before the create
 * preflight runs — the way a fork PR's branch is fetched first
 * (`pull-request-checkout.ts`) — so the preflight, the checkout and a Retry
 * all see one ordinary local branch. The local name was planned by the
 * listing; here it is only made, or found already tracking the same branch.
 * Anything else under that name is refused, never overwritten.
 *
 * Real repositories on disk and real `git`.
 */

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function readConfig(repoDir: string, key: string): Promise<string> {
  return git(['config', '--get', key], repoDir);
}

describe('createRemoteTrackingBranch', () => {
  let root: string;
  let repoDir: string;
  let upstreamTip: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-tracking-'));
    const originDir = path.join(root, 'origin.git');
    const upstreamDir = path.join(root, 'upstream.git');
    const author = path.join(root, 'author');
    repoDir = path.join(root, 'repo');
    for (const dir of [originDir, upstreamDir]) {
      fs.mkdirSync(dir);
      // HEAD names main, so the clone checks out main without relying on
      // the machine's init.defaultBranch (unset here: bare HEAD was master).
      await git(['init', '--bare', '-b', 'main'], dir);
    }
    fs.mkdirSync(author);
    await git(['init'], author);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], author);
    await git(['config', 'user.email', 'test@test.com'], author);
    await git(['config', 'user.name', 'Test'], author);
    await git(['commit', '--allow-empty', '-m', 'init'], author);
    await git(['remote', 'add', 'origin', originDir], author);
    await git(['remote', 'add', 'upstream', upstreamDir], author);
    await git(['push', 'origin', 'main'], author);
    await git(['push', 'upstream', 'main'], author);
    await git(['switch', '-c', 'feature-up'], author);
    await git(['commit', '--allow-empty', '-m', 'upstream only'], author);
    await git(['push', 'upstream', 'feature-up'], author);
    upstreamTip = await git(['rev-parse', 'HEAD'], author);

    await git(['clone', originDir, repoDir], root);
    // Added, never fetched: the branch is fetched by the call under test.
    await git(['remote', 'add', 'upstream', upstreamDir], repoDir);
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it('makes a local branch tracking a branch only another remote has, and a lane checks it out', async () => {
    const result = await createRemoteTrackingBranch({
      repoPath: repoDir,
      localBranch: 'feature-up',
      remote: 'upstream',
      branch: 'feature-up',
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(await git(['rev-parse', 'refs/heads/feature-up'], repoDir)).toBe(upstreamTip);
    expect(await readConfig(repoDir, 'branch.feature-up.remote')).toBe('upstream');
    expect(await readConfig(repoDir, 'branch.feature-up.merge')).toBe('refs/heads/feature-up');
    // The user's checkout is never switched.
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir)).toBe('main');

    const pool = path.join(root, 'pool');
    fs.mkdirSync(pool);
    const service = new WorktreeService({
      worktreePoolPath: pool,
      repoPath: repoDir,
      ctx: new LocalExecutionContext({ root: repoDir }),
      host: await LocalWorktreeHost.create({ allowedRoots: [repoDir, pool] }),
    });
    const checkout = await service.checkoutExistingBranch({ branchName: 'feature-up', slug: 'up' });
    expect(checkout.success).toBe(true);
    if (!checkout.success) return;
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], checkout.data)).toBe('feature-up');
    expect(await git(['rev-parse', '--abbrev-ref', '@{upstream}'], checkout.data)).toBe(
      'upstream/feature-up'
    );
  });

  it('names a local branch after its remote, as gh does for a fork', async () => {
    const result = await createRemoteTrackingBranch({
      repoPath: repoDir,
      localBranch: 'upstream/main',
      remote: 'upstream',
      branch: 'main',
    });

    expect(result.success).toBe(true);
    expect(await readConfig(repoDir, 'branch.upstream/main.remote')).toBe('upstream');
    expect(await readConfig(repoDir, 'branch.upstream/main.merge')).toBe('refs/heads/main');
    // origin's main, the root's branch, is untouched.
    expect(await readConfig(repoDir, 'branch.main.remote')).toBe('origin');
  });

  it('keeps a local branch that already tracks the same remote branch', async () => {
    await git(['fetch', 'upstream'], repoDir);
    await git(['branch', '--track', 'feature-up', 'refs/remotes/upstream/feature-up'], repoDir);
    const before = await git(['rev-parse', 'refs/heads/feature-up'], repoDir);

    const result = await createRemoteTrackingBranch({
      repoPath: repoDir,
      localBranch: 'feature-up',
      remote: 'upstream',
      branch: 'feature-up',
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(await git(['rev-parse', 'refs/heads/feature-up'], repoDir)).toBe(before);
  });

  it('refuses a local branch of that name that is something else, and leaves it as it was', async () => {
    await git(['branch', 'feature-up', 'main'], repoDir);
    const before = await git(['rev-parse', 'refs/heads/feature-up'], repoDir);

    const result = await createRemoteTrackingBranch({
      repoPath: repoDir,
      localBranch: 'feature-up',
      remote: 'upstream',
      branch: 'feature-up',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'branch_exists', branch: 'feature-up' });
    expect(result.error.message).toContain('upstream/feature-up');
    expect(await git(['rev-parse', 'refs/heads/feature-up'], repoDir)).toBe(before);
  });

  it('refuses a branch the remote does not have', async () => {
    const result = await createRemoteTrackingBranch({
      repoPath: repoDir,
      localBranch: 'ghost',
      remote: 'upstream',
      branch: 'ghost',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'branch_not_found', branch: 'upstream/ghost' });
    await expect(git(['rev-parse', '--verify', 'refs/heads/ghost'], repoDir)).rejects.toThrow();
  });
});
