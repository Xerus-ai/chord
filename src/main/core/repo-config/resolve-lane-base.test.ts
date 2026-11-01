import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  copyGitRemoteFixture,
  createGitRemoteTemplate,
  git,
  removeGitFixture,
} from '@main/core/git/_testing/git-remote-fixture';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolveLaneBase } from './resolve-lane-base';

async function configureIdentity(dir: string): Promise<void> {
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}

describe('resolveLaneBase', () => {
  let root: string;
  let remoteDir: string;
  let userRepo: string;
  let teammateRepo: string;

  let template: string;

  beforeAll(async () => {
    template = await createGitRemoteTemplate();
  });

  afterAll(() => {
    removeGitFixture(template);
  });

  beforeEach(() => {
    const fixture = copyGitRemoteFixture(template, 'lane-base-');
    root = fixture.root;
    remoteDir = fixture.remoteDir;
    userRepo = fixture.cloneDir;
    teammateRepo = fixture.pusherDir;
  });

  afterEach(() => {
    removeGitFixture(root);
  });

  async function pushNewRemoteCommit(message: string): Promise<string> {
    await git(['commit', '--allow-empty', '-m', message], teammateRepo);
    await git(['push', 'origin', 'main'], teammateRepo);
    return git(['rev-parse', 'HEAD'], teammateRepo);
  }

  it('forks from the fetched remote default, not from what the root has checked out', async () => {
    // The root sits on a local branch of its own, and origin has moved on
    // since the clone last fetched.
    await git(['switch', '-c', 'my-local-work'], userRepo);
    await git(['commit', '--allow-empty', '-m', 'local only'], userRepo);
    const remoteTip = await pushNewRemoteCommit('teammate change');

    const result = await resolveLaneBase({ repoPath: userRepo });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetRef).toBe('origin/main');
    expect(result.data.forkSha).toBe(remoteTip);
    expect(result.data.forkSource).toBe('fetched');
    // Resolving never switches the user's checkout.
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], userRepo)).toBe('my-local-work');
  });

  it('resolves an explicit base branch name against the remote and fetches it', async () => {
    const remoteTip = await pushNewRemoteCommit('teammate change');

    const result = await resolveLaneBase({ repoPath: userRepo, baseRef: 'main' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetRef).toBe('origin/main');
    expect(result.data.forkSha).toBe(remoteTip);
  });

  it('uses a branch that exists only locally when that is what was asked for', async () => {
    await git(['branch', 'spike'], userRepo);
    const spikeTip = await git(['rev-parse', 'spike'], userRepo);

    const result = await resolveLaneBase({ repoPath: userRepo, baseRef: 'spike' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetRef).toBe('spike');
    expect(result.data.forkSha).toBe(spikeTip);
    expect(result.data.forkSource).toBe('local');
  });

  it("honours the team file's baseBranch at the remote default", async () => {
    await git(['switch', '-c', 'develop'], teammateRepo);
    await git(['commit', '--allow-empty', '-m', 'develop work'], teammateRepo);
    await git(['push', 'origin', 'develop'], teammateRepo);
    const developTip = await git(['rev-parse', 'HEAD'], teammateRepo);
    await git(['switch', 'main'], teammateRepo);
    fs.writeFileSync(
      path.join(teammateRepo, '.chord.json'),
      JSON.stringify({ baseBranch: 'develop' })
    );
    await git(['add', '.chord.json'], teammateRepo);
    await git(['commit', '-m', 'team base'], teammateRepo);
    await git(['push', 'origin', 'main'], teammateRepo);

    const result = await resolveLaneBase({ repoPath: userRepo });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetRef).toBe('origin/develop');
    expect(result.data.forkSha).toBe(developTip);
  });

  it('lets the just-me base branch override the team file', async () => {
    await git(['switch', '-c', 'release'], teammateRepo);
    await git(['commit', '--allow-empty', '-m', 'release work'], teammateRepo);
    await git(['push', 'origin', 'release'], teammateRepo);
    const releaseTip = await git(['rev-parse', 'HEAD'], teammateRepo);

    const result = await resolveLaneBase({ repoPath: userRepo, justMeBaseBranch: 'release' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetRef).toBe('origin/release');
    expect(result.data.forkSha).toBe(releaseTip);
  });

  it('finds the remote default when origin/HEAD was never recorded', async () => {
    // A remote added by hand (not cloned) has no refs/remotes/origin/HEAD.
    const handAdded = path.join(root, 'hand-added');
    fs.mkdirSync(handAdded);
    await git(['init'], handAdded);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/scratch'], handAdded);
    await configureIdentity(handAdded);
    await git(['commit', '--allow-empty', '-m', 'scratch'], handAdded);
    await git(['remote', 'add', 'origin', remoteDir], handAdded);
    await git(['fetch', 'origin'], handAdded);
    const remoteTip = await git(['rev-parse', 'origin/main'], handAdded);

    const result = await resolveLaneBase({ repoPath: handAdded });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetRef).toBe('origin/main');
    expect(result.data.forkSha).toBe(remoteTip);
  });

  it('refuses to fork from the last-fetched ref on its own when the fetch fails', async () => {
    const fetchedTip = await git(['rev-parse', 'origin/main'], userRepo);
    removeDirSync(remoteDir);

    const result = await resolveLaneBase({ repoPath: userRepo });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({
      type: 'base_fetch_failed',
      ref: 'origin/main',
      lastFetchedSha: fetchedTip,
    });
    if (result.error.type !== 'base_fetch_failed') return;
    // devstation-kcvy: the sentence is the user's; what git said is apart,
    // without Node's "Command failed: git fetch …" preamble.
    expect(result.error.message).toBe(
      'Could not fetch origin/main, so its newest commit is unknown.'
    );
    expect(result.error.gitOutput).toMatch(/^fatal: /);
    expect(result.error.gitOutput).not.toMatch(/Command failed/);
  });

  it('forks from the last-fetched ref when the user chose the local copy, and says so', async () => {
    const fetchedTip = await git(['rev-parse', 'origin/main'], userRepo);
    removeDirSync(remoteDir);

    const result = await resolveLaneBase({ repoPath: userRepo, allowLocalCopy: true });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      targetRef: 'origin/main',
      forkSha: fetchedTip,
      forkSource: 'local_copy',
    });
  });

  it('forks a repository with no remote from its checked-out branch', async () => {
    const localOnly = path.join(root, 'local-only');
    fs.mkdirSync(localOnly);
    await git(['init'], localOnly);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/trunk'], localOnly);
    await configureIdentity(localOnly);
    await git(['commit', '--allow-empty', '-m', 'init'], localOnly);
    const tip = await git(['rev-parse', 'HEAD'], localOnly);

    const result = await resolveLaneBase({ repoPath: localOnly });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetRef).toBe('trunk');
    expect(result.data.forkSha).toBe(tip);
    expect(result.data.forkSource).toBe('local');
  });

  it('reports a base branch that exists nowhere', async () => {
    const result = await resolveLaneBase({ repoPath: userRepo, baseRef: 'no-such-branch' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('base_not_found');
  });
});
