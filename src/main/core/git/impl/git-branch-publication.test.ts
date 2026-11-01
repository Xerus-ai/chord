import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { GitService } from './git-service';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' }).trim();
}

function configure(repo: string): void {
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Chord Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
}

function commit(repo: string, message: string): void {
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
}

function serviceAt(repo: string): GitService {
  const ctx = new LocalExecutionContext({ root: repo });
  return new GitService(ctx, ctx, new LocalFileSystem(repo));
}

/**
 * Whether the checked-out branch is on the remote is its own fact, read from
 * where Chord's Push sends it — not guessed from the commit list. The band used
 * "any commit is pushed" as "the branch is published", and the ahead count fell
 * back to `origin/HEAD` and then to 0, so a lane branch that was never pushed
 * (and every branch in a repo with no remote) read "Pushed · no pull request"
 * (devstation-dh2, devstation-7eq).
 */
describe('GitService.getLog publication', () => {
  let root: string;
  let upstream: string;
  let clone: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-publication-'));
    upstream = path.join(root, 'upstream');
    clone = path.join(root, 'clone');
    fs.mkdirSync(upstream);
    git(upstream, 'init', '-q', '-b', 'main');
    configure(upstream);
    commit(upstream, 'base one');
    commit(upstream, 'base two');
    git(root, 'clone', '-q', upstream, clone);
    configure(clone);
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it('a lane branch never pushed, with no commits of its own, is unpublished', async () => {
    git(clone, 'checkout', '-q', '-b', 'chord/lane', 'origin/main');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'unpublished', branch: 'chord/lane' });
    expect(log.aheadCount).toBe(0);
  });

  it('a lane branch never pushed counts only the commits no remote has', async () => {
    git(clone, 'checkout', '-q', '-b', 'chord/lane', 'origin/main');
    commit(clone, 'lane one');
    commit(clone, 'lane two');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'unpublished', branch: 'chord/lane' });
    expect(log.aheadCount).toBe(2);
    expect(log.commits.map((c) => [c.subject, c.isPushed])).toEqual([
      ['lane two', false],
      ['lane one', false],
      ['base two', true],
      ['base one', true],
    ]);
  });

  it('a branch created tracking origin/main is not published as origin/main', async () => {
    git(clone, 'checkout', '-q', '--track', '-b', 'chord/tracking', 'origin/main');
    commit(clone, 'lane one');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'unpublished', branch: 'chord/tracking' });
    expect(log.aheadCount).toBe(1);
  });

  it('a branch published with an upstream counts the commits after the push', async () => {
    git(clone, 'checkout', '-q', '-b', 'chord/lane', 'origin/main');
    commit(clone, 'pushed');
    git(clone, 'push', '-q', '-u', 'origin', 'chord/lane');
    commit(clone, 'not pushed');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'published', ref: 'origin/chord/lane' });
    expect(log.aheadCount).toBe(1);
  });

  it('a branch pushed from a terminal without -u is published where Push sends it', async () => {
    git(clone, 'checkout', '-q', '-b', 'chord/lane', 'origin/main');
    commit(clone, 'pushed');
    git(clone, 'push', '-q', 'origin', 'chord/lane');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'published', ref: 'origin/chord/lane' });
    expect(log.aheadCount).toBe(0);
  });

  it('a branch whose remote copy was deleted and pruned is unpublished', async () => {
    git(clone, 'checkout', '-q', '-b', 'chord/lane', 'origin/main');
    commit(clone, 'pushed');
    git(clone, 'push', '-q', '-u', 'origin', 'chord/lane');
    git(upstream, 'branch', '-D', 'chord/lane');
    git(clone, 'fetch', '-q', '--prune', 'origin');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'unpublished', branch: 'chord/lane' });
    expect(log.aheadCount).toBe(1);
  });

  it('a fork pull request checkout is published at the fork branch Push writes to', async () => {
    const fork = path.join(root, 'fork');
    git(root, 'clone', '-q', '--bare', upstream, fork);
    git(fork, 'branch', 'their-feature', 'main');
    git(clone, 'remote', 'add', 'contributor', fork);
    git(clone, 'fetch', '-q', 'contributor');
    git(clone, 'checkout', '-q', '-b', 'pr-7', 'contributor/their-feature');
    git(clone, 'config', 'branch.pr-7.remote', 'contributor');
    git(clone, 'config', 'branch.pr-7.merge', 'refs/heads/their-feature');
    git(clone, 'config', 'branch.pr-7.chordPullRequest', '7');
    commit(clone, 'maintainer fix');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'published', ref: 'contributor/their-feature' });
    expect(log.aheadCount).toBe(1);
  });

  it('a repository with no remote says so, and no commit reads as pushed', async () => {
    const local = path.join(root, 'local');
    fs.mkdirSync(local);
    git(local, 'init', '-q', '-b', 'main');
    configure(local);
    commit(local, 'one');
    commit(local, 'two');

    const log = await serviceAt(local).getLog();

    expect(log.publication).toEqual({ kind: 'no_remote' });
    expect(log.aheadCount).toBe(2);
    expect(log.commits.every((c) => !c.isPushed)).toBe(true);
  });

  it('a detached checkout has no branch to publish', async () => {
    git(clone, 'checkout', '-q', '--detach', 'origin/main');
    commit(clone, 'detached work');

    const log = await serviceAt(clone).getLog();

    expect(log.publication).toEqual({ kind: 'detached' });
    expect(log.aheadCount).toBe(1);
  });
});
