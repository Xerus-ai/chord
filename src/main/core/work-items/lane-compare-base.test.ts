import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { readBranchPublication } from '@main/core/git/impl/git-branch-publication';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readLaneCommittedChanges, resolveLaneCompareBase } from './lane-compare-base';
import { resolveWorkItemBranchInfo } from './resolve-branch-info';

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
 * Settings › Git › Compare base picks between the repository default and the
 * branch's upstream for committed-change comparisons only; PR and rebase targets don't move. In Chord the repository
 * default is the lane's `target_ref`, and the upstream is the branch's
 * `@{upstream}` — so upstream shows only work not yet pushed.
 *
 * When there is no upstream, Chord says so: a typed `no_upstream`, never the
 * repository default standing in for it.
 */
describe('resolveLaneCompareBase / readLaneCommittedChanges', () => {
  let root: string;
  let upstream: string;
  let clone: string;
  let lane: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-compare-base-'));
    upstream = path.join(root, 'upstream');
    clone = path.join(root, 'clone');
    lane = path.join(root, 'lane');
    fs.mkdirSync(upstream);
    git(upstream, 'init', '-q', '-b', 'main');
    configure(upstream);
    commitFile(upstream, 'base.txt', 1, 'base');

    git(root, 'clone', '-q', upstream, clone);
    configure(clone);

    // The lane forks from origin/main, pushes one commit, and keeps one local.
    git(clone, 'worktree', 'add', '-q', '-b', 'chord/lane', lane, 'origin/main');
    commitFile(lane, 'pushed.txt', 3, 'pushed work');
    git(lane, 'push', '-q', '-u', 'origin', 'chord/lane');
    commitFile(lane, 'unpushed.txt', 5, 'unpushed work');
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it("repoDefault is the lane's target ref", async () => {
    const branchInfo = await resolveWorkItemBranchInfo(lane);

    const base = await resolveLaneCompareBase(
      { worktreePath: lane, branchName: 'chord/lane', targetRef: 'origin/main', branchInfo },
      'repoDefault'
    );

    expect(base).toEqual({ kind: 'ref', mode: 'repoDefault', ref: 'origin/main' });
  });

  it("repoDefault on a row with no recorded target is the repository's default branch", async () => {
    const branchInfo = await resolveWorkItemBranchInfo(lane);

    const base = await resolveLaneCompareBase(
      { worktreePath: lane, branchName: 'chord/lane', targetRef: null, branchInfo },
      'repoDefault'
    );

    expect(base).toEqual({ kind: 'ref', mode: 'repoDefault', ref: 'main' });
  });

  it("upstream is the branch's upstream", async () => {
    const branchInfo = await resolveWorkItemBranchInfo(lane);

    const base = await resolveLaneCompareBase(
      { worktreePath: lane, branchName: 'chord/lane', targetRef: 'origin/main', branchInfo },
      'upstream'
    );

    expect(base).toEqual({ kind: 'ref', mode: 'upstream', ref: 'origin/chord/lane' });
  });

  it('upstream on a branch never pushed is no_upstream, not the target ref', async () => {
    const other = path.join(root, 'other');
    git(clone, 'worktree', 'add', '-q', '-b', 'chord/other', other, 'origin/main');
    const branchInfo = await resolveWorkItemBranchInfo(other);

    const base = await resolveLaneCompareBase(
      { worktreePath: other, branchName: 'chord/other', targetRef: 'origin/main', branchInfo },
      'upstream'
    );

    expect(base).toEqual({ kind: 'no_upstream', branch: 'chord/other' });
  });

  it('upstream whose remote branch was deleted and pruned is no_upstream', async () => {
    git(upstream, 'branch', '-D', 'chord/lane');
    git(lane, 'fetch', '-q', '--prune', 'origin');
    const branchInfo = await resolveWorkItemBranchInfo(lane);

    const base = await resolveLaneCompareBase(
      { worktreePath: lane, branchName: 'chord/lane', targetRef: 'origin/main', branchInfo },
      'upstream'
    );

    expect(base).toEqual({ kind: 'no_upstream', branch: 'chord/lane' });
  });

  // devstation-ama: after `git branch --unset-upstream` the remote copy is
  // still where Chord's Push sends the branch, so the scope row counted "↑1"
  // against it while this resolver, reading only `%(push)`, said the branch
  // had no upstream. One branch, one remote copy: both read the same ref.
  it('upstream with tracking unset is the remote copy Push writes to, as the ahead count reads it', async () => {
    git(lane, 'branch', '--unset-upstream');
    const branchInfo = await resolveWorkItemBranchInfo(lane);

    const base = await resolveLaneCompareBase(
      { worktreePath: lane, branchName: 'chord/lane', targetRef: 'origin/main', branchInfo },
      'upstream'
    );
    const { publication, aheadCount } = await readBranchPublication(
      new LocalExecutionContext({ root: lane })
    );

    expect(publication).toEqual({ kind: 'published', ref: 'origin/chord/lane' });
    expect(aheadCount).toBe(1);
    expect(base).toEqual({ kind: 'ref', mode: 'upstream', ref: 'origin/chord/lane' });
  });

  it('a detached checkout has no upstream to compare against', async () => {
    git(lane, 'checkout', '-q', '--detach');
    const branchInfo = await resolveWorkItemBranchInfo(lane);

    const base = await resolveLaneCompareBase(
      { worktreePath: lane, branchName: null, targetRef: 'origin/main', branchInfo },
      'upstream'
    );

    expect(base).toEqual({ kind: 'no_upstream', branch: null });
  });

  it('committed changes against the target ref are every commit the lane made', async () => {
    const changes = await readLaneCommittedChanges(lane, {
      kind: 'ref',
      mode: 'repoDefault',
      ref: 'origin/main',
    });

    expect(changes).toEqual([
      { path: 'pushed.txt', status: 'added', additions: 3, deletions: 0 },
      { path: 'unpushed.txt', status: 'added', additions: 5, deletions: 0 },
    ]);
  });

  it('committed changes against the upstream are only the unpushed commits', async () => {
    const changes = await readLaneCommittedChanges(lane, {
      kind: 'ref',
      mode: 'upstream',
      ref: 'origin/chord/lane',
    });

    expect(changes).toEqual([
      { path: 'unpushed.txt', status: 'added', additions: 5, deletions: 0 },
    ]);
  });

  it('a compare ref that does not resolve throws instead of reading as no changes', async () => {
    await expect(
      readLaneCommittedChanges(lane, { kind: 'ref', mode: 'repoDefault', ref: 'origin/missing' })
    ).rejects.toThrow();
  });
});
