import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readWorktreeBranchState } from './worktree-change-summary';
import { aggregateDiffStats, readWorktreeDiffStats } from './worktree-diff-stats';

/** The checkout's branch facts; a test repo that cannot be read is a broken setup. */
async function readBranchInfo(worktreePath: string) {
  const state = await readWorktreeBranchState(worktreePath);
  if (state.kind !== 'readable') throw new Error(state.message);
  return state.info;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

/** Where the lane merges, as `resolveLaneCompareBase` gives it in repoDefault mode. */
const TARGET = { kind: 'ref', mode: 'repoDefault', ref: 'origin/main' } as const;

function commitFile(repo: string, file: string, lines: number, message: string): void {
  const body = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');
  fs.writeFileSync(path.join(repo, file), `${body}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

describe('aggregateDiffStats', () => {
  it('is null when every worktree is unknown', () => {
    expect(aggregateDiffStats([null, null])).toBeNull();
  });

  it('sums known worktrees and ignores unknown ones', () => {
    expect(aggregateDiffStats([{ added: 10, removed: 2 }, null, { added: 3, removed: 1 }])).toEqual(
      { added: 13, removed: 3 }
    );
  });

  it("is the single worktree's stats when there is only one", () => {
    expect(aggregateDiffStats([{ added: 4, removed: 0 }])).toEqual({ added: 4, removed: 0 });
  });
});

/**
 * devstation-sun: a lane forked from `origin/main` in a clone whose local
 * `main` had diverged from it (130 ahead, 346 behind on D:\Kami) showed
 * +84326 −7292 for one changed file — exactly `main...origin/main`. A lane's
 * committed delta is measured against where it merges (`target_ref`), not
 * against whatever the local branch of that name happens to hold.
 */
describe('readWorktreeDiffStats', () => {
  let root: string;
  let upstream: string;
  let clone: string;
  let lane: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-diffstats-'));
    upstream = path.join(root, 'upstream');
    clone = path.join(root, 'clone');
    lane = path.join(root, 'lane');
    fs.mkdirSync(upstream);
    git(upstream, 'init', '-q', '-b', 'main');
    git(upstream, 'config', 'user.email', 'test@example.com');
    git(upstream, 'config', 'user.name', 'Chord Test');
    git(upstream, 'config', 'commit.gpgsign', 'false');
    commitFile(upstream, 'base.txt', 1, 'base');

    git(root, 'clone', '-q', upstream, clone);
    git(clone, 'config', 'user.email', 'test@example.com');
    git(clone, 'config', 'user.name', 'Chord Test');
    git(clone, 'config', 'commit.gpgsign', 'false');
    // The local main diverges: a commit of its own the remote never gets…
    commitFile(clone, 'local-only.txt', 7, 'local only');
    // …while the remote moves on, fetched into origin/main only.
    commitFile(upstream, 'remote-1.txt', 40, 'remote 1');
    commitFile(upstream, 'remote-2.txt', 60, 'remote 2');
    git(clone, 'fetch', '-q', 'origin');

    // The lane forks from origin/main, as lane-checkout does, and changes one file.
    git(clone, 'worktree', 'add', '-q', '-b', 'chord/lane', lane, 'origin/main');
    commitFile(lane, 'lane.txt', 3, 'lane work');
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it("counts only the lane's own commits against its target ref", async () => {
    const ctx = await readBranchInfo(lane);
    expect(ctx?.defaultBranch).toBe('main');

    const stats = await readWorktreeDiffStats(lane, 'chord/lane', TARGET, ctx);

    expect(stats).toEqual({ added: 3, removed: 0 });
  });

  it('adds what the working tree holds on top of the commits', async () => {
    fs.writeFileSync(path.join(lane, 'lane.txt'), 'line 1\nline 2\nline 3\nline 4\n');
    const ctx = await readBranchInfo(lane);

    const stats = await readWorktreeDiffStats(lane, 'chord/lane', TARGET, ctx);

    expect(stats).toEqual({ added: 4, removed: 0 });
  });

  // devstation-ui4: an item whose only change is a new file showed no +/−
  // while its Changes tab listed it.
  it('counts new untracked files in the checked-out lane', async () => {
    fs.mkdirSync(path.join(lane, 'fixtures'));
    fs.writeFileSync(path.join(lane, 'fixtures', 'card.tsx'), 'a\nb\nc\nd\ne\n');
    const ctx = await readBranchInfo(lane);

    const stats = await readWorktreeDiffStats(lane, 'chord/lane', TARGET, ctx);

    expect(stats).toEqual({ added: 8, removed: 0 });
  });

  it('measures the root checkout of the default branch by its working tree alone', async () => {
    const ctx = await readBranchInfo(clone);

    // `main` is the branch checked out in the clone, and the base it would be
    // compared to: only its working tree counts.
    const stats = await readWorktreeDiffStats(
      clone,
      'main',
      { kind: 'ref', mode: 'repoDefault', ref: 'main' },
      ctx
    );

    expect(stats).toEqual({ added: 0, removed: 0 });
  });

  /**
   * Settings › Git › Compare base = upstream: only what the remote does not
   * have yet. The upstream of `chord/lane` is `origin/chord/lane` — a ref that
   * ends in the branch's own name, which the repoDefault rule skips as "the
   * same branch" (a root `main` against `origin/main`). For upstream that ref
   * is exactly the base.
   */
  it('counts only the unpushed commits against the upstream', async () => {
    git(lane, 'push', '-q', '-u', 'origin', 'chord/lane');
    commitFile(lane, 'unpushed.txt', 5, 'unpushed work');
    const ctx = await readBranchInfo(lane);

    const stats = await readWorktreeDiffStats(
      lane,
      'chord/lane',
      { kind: 'ref', mode: 'upstream', ref: 'origin/chord/lane' },
      ctx
    );

    expect(stats).toEqual({ added: 5, removed: 0 });
  });

  it('counts the working tree of a fully pushed branch against the upstream', async () => {
    git(lane, 'push', '-q', '-u', 'origin', 'chord/lane');
    fs.writeFileSync(path.join(lane, 'draft.txt'), 'a\nb\n');
    const ctx = await readBranchInfo(lane);

    const stats = await readWorktreeDiffStats(
      lane,
      'chord/lane',
      { kind: 'ref', mode: 'upstream', ref: 'origin/chord/lane' },
      ctx
    );

    expect(stats).toEqual({ added: 2, removed: 0 });
  });

  it('counts pushed and unpushed commits alike against the target ref', async () => {
    git(lane, 'push', '-q', '-u', 'origin', 'chord/lane');
    commitFile(lane, 'unpushed.txt', 5, 'unpushed work');
    const ctx = await readBranchInfo(lane);

    const stats = await readWorktreeDiffStats(lane, 'chord/lane', TARGET, ctx);

    expect(stats).toEqual({ added: 8, removed: 0 });
  });
});
