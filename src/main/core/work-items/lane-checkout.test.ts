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
import { provisionLaneCheckout } from './lane-checkout';

async function worktreePaths(repoDir: string): Promise<string[]> {
  const out = await git(['worktree', 'list', '--porcelain'], repoDir);
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

describe('provisionLaneCheckout', () => {
  let root: string;
  let remoteDir: string;
  let repoDir: string;
  let poolDir: string;

  let template: string;

  beforeAll(async () => {
    template = await createGitRemoteTemplate();
  });

  afterAll(() => {
    removeGitFixture(template);
  });

  beforeEach(() => {
    const fixture = copyGitRemoteFixture(template, 'lane-checkout-');
    root = fixture.root;
    remoteDir = fixture.remoteDir;
    repoDir = fixture.cloneDir;
    poolDir = path.join(root, 'pool');
  });

  afterEach(() => {
    removeGitFixture(root);
  });

  it('refuses to reuse the branch the root has checked out, and creates no checkout', async () => {
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir)).toBe('main');

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'existing', branchName: 'main' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('branch_checked_out');
    expect(result.error.message).toContain('main');
    expect(await worktreePaths(repoDir)).toHaveLength(1);
    expect(fs.existsSync(poolDir) ? fs.readdirSync(poolDir) : []).toEqual([]);
  });

  it('forks a new lane from base main without touching the root checkout', async () => {
    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: 'chord/fix-login-a1b', baseRef: 'main' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const lane = result.data;
    expect(lane.targetRef).toBe('origin/main');
    expect(lane.forkSha).toBe(await git(['rev-parse', 'origin/main'], repoDir));
    expect(lane.branchOrigin).toBe('chord');
    expect(lane.forkSource).toBe('fetched');
    expect(lane.slug).toBe('fix-login-a1b');
    expect(lane.worktreePath).toBe(path.join(poolDir, 'fix-login-a1b'));
    expect(await git(['rev-parse', 'HEAD'], lane.worktreePath)).toBe(lane.forkSha);
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir)).toBe('main');
  });

  it('gives two lanes whose branch leaves collide their own directories', async () => {
    const first = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: 'alice/fix' },
    });
    const second = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: 'bob/fix' },
    });

    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(first.data.slug).toBe('fix');
    expect(second.data.slug).toBe('fix-2');
    expect(second.data.worktreePath).not.toBe(first.data.worktreePath);
  });

  it('checks out an existing branch as a user-named lane targeting the remote default', async () => {
    await git(['branch', 'feature/mine'], repoDir);
    const tip = await git(['rev-parse', 'feature/mine'], repoDir);

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'existing', branchName: 'feature/mine' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.branchOrigin).toBe('user');
    expect(result.data.targetRef).toBe('origin/main');
    expect(result.data.forkSha).toBe(tip);
    // The slug is the branch's leaf, like every other lane's.
    expect(result.data.slug).toBe('mine');
    // A checkout of an existing branch forks from nothing.
    expect(result.data.forkSource).toBeNull();
  });

  it('checks out an existing local branch while the remote is unreachable', async () => {
    await git(['branch', 'feature/offline'], repoDir);
    removeDirSync(remoteDir);

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'existing', branchName: 'feature/offline' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // The PR target is read from what this clone recorded, without a fetch.
    expect(result.data.targetRef).toBe('origin/main');
  });

  it('keeps "not found" and "already exists" as their own error types', async () => {
    const missing = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'existing', branchName: 'feature/nowhere' },
    });
    expect(missing.success).toBe(false);
    if (missing.success) return;
    expect(missing.error).toMatchObject({ type: 'branch_not_found', branch: 'feature/nowhere' });

    await git(['branch', 'chord/taken'], repoDir);
    const taken = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: 'chord/taken' },
    });
    expect(taken.success).toBe(false);
    if (taken.success) return;
    expect(taken.error).toMatchObject({ type: 'branch_exists', branch: 'chord/taken' });
  });

  it('fails a new lane whose base cannot be fetched, offering the last-fetched copy', async () => {
    const fetchedTip = await git(['rev-parse', 'origin/main'], repoDir);
    removeDirSync(remoteDir);

    const refused = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: 'chord/offline-a1b' },
    });
    expect(refused.success).toBe(false);
    if (refused.success) return;
    expect(refused.error).toMatchObject({
      type: 'base_fetch_failed',
      ref: 'origin/main',
      lastFetchedSha: fetchedTip,
    });
    expect(await worktreePaths(repoDir)).toHaveLength(1);

    const chosen = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: 'chord/offline-a1b' },
      allowLocalCopy: true,
    });
    expect(chosen.success).toBe(true);
    if (!chosen.success) return;
    expect(chosen.data.forkSha).toBe(fetchedTip);
    expect(chosen.data.forkSource).toBe('local_copy');
  });

  it('forks a secondary lane from the work item branch, keeping its target', async () => {
    const primary = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: { kind: 'new', branchName: 'chord/item-a1b' },
    });
    expect(primary.success).toBe(true);
    if (!primary.success) return;
    await git(['commit', '--allow-empty', '-m', 'work'], primary.data.worktreePath);
    const itemTip = await git(['rev-parse', 'HEAD'], primary.data.worktreePath);

    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: poolDir,
      request: {
        kind: 'fork',
        branchName: 'chord/item-a1b--2',
        startRef: 'chord/item-a1b',
        targetRef: primary.data.targetRef,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.forkSha).toBe(itemTip);
    expect(result.data.targetRef).toBe('origin/main');
    expect(result.data.branchOrigin).toBe('chord');
    expect(result.data.forkSource).toBe('local');
  });
});
