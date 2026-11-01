import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { publishBranch, push } from '@main/core/git/impl/git-remote-ops';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { checkOutPullRequestBranch, planPullRequestBranch } from './pull-request-checkout';

/**
 * Checking out a PR the way `gh pr checkout` does (pkg/cmd/pr/checkout,
 * `cmdsForMissingRemote`), against REAL repositories on disk: a bare origin
 * holding `refs/pull/<n>/head` the way GitHub does, and a bare fork holding
 * the PR's branch.
 *   - The branch is fetched from origin's pull ref, so a fork PR — even one
 *     whose fork was deleted — checks out without the fork.
 *   - It is named after the head branch, or `<owner>/<head>` when that would
 *     take the default branch's name (gh's rule) or a local branch that
 *     already means something else.
 *   - A fork that accepts maintainer pushes becomes a remote (an existing one
 *     for the same fork is reused) and the branch tracks `<fork>/<head>`, so a
 *     push updates the PR, even when the local name differs.
 *   - Otherwise the branch keeps gh's config (`origin`, `refs/pull/<n>/head`)
 *     and a push is refused with a typed error rather than publishing a new
 *     branch somewhere the PR never sees.
 *   - The user's own checkout is not switched: the lane's worktree checks the
 *     branch out later, as any `existingBranch`.
 */

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function configureIdentity(dir: string): Promise<void> {
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}

async function refExists(repo: string, ref: string): Promise<boolean> {
  const out = await git(['for-each-ref', '--format=%(refname)', ref], repo);
  return out === ref;
}

/**
 * rmSync's maxRetries does not retry EPERM (Node 24, devstation-uag): a folder
 * a git process is still letting go of is retried here, bounded.
 */
async function removeDir(dir: string): Promise<void> {
  await vi.waitFor(() => fs.rmSync(dir, { recursive: true, force: true }), { timeout: 10_000 });
}

describe('checking out a pull request', () => {
  let root: string;
  let originDir: string;
  let forkDir: string;
  let repoDir: string;
  /** The PR's head commit on the fork's `fix-typo` (PR #1). */
  let fixTypoSha: string;
  /** The head commit of a PR opened from the fork's own `main` (PR #2). */
  let forkMainSha: string;

  /**
   * The repositories are built once, with ~20 git spawns, and copied for each
   * test: built per test they took the setup hook past its 30 s budget under
   * the full suite's worker pool, and the timed-out hook's git then held the
   * folder its cleanup was removing (verify 2026-10-05).
   */
  let template: string;
  beforeAll(async () => {
    template = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-checkout-template-'));
    const origin = path.join(template, 'origin.git');
    const fork = path.join(template, 'alice-fork.git');
    const author = path.join(template, 'author');

    for (const bare of [origin, fork]) {
      fs.mkdirSync(bare);
      await git(['init', '--bare'], bare);
      await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare);
    }
    fs.mkdirSync(author);
    await git(['init'], author);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], author);
    await configureIdentity(author);
    await git(['commit', '--allow-empty', '-m', 'init'], author);
    await git(['push', origin, 'main'], author);
    await git(['push', fork, 'main'], author);

    await git(['checkout', '-b', 'fix-typo'], author);
    await git(['commit', '--allow-empty', '-m', 'fix the typo'], author);
    fixTypoSha = await git(['rev-parse', 'HEAD'], author);
    await git(['push', fork, 'fix-typo'], author);

    await git(['checkout', '-b', 'fork-main', 'main'], author);
    await git(['commit', '--allow-empty', '-m', 'work on the fork main'], author);
    forkMainSha = await git(['rev-parse', 'HEAD'], author);
    await git(['push', fork, 'fork-main:main'], author);

    // What GitHub keeps on the base repository for every PR, fork or not.
    await git(['push', origin, `${fixTypoSha}:refs/pull/1/head`], author);
    await git(['push', origin, `${forkMainSha}:refs/pull/2/head`], author);

    await git(['clone', origin, path.join(template, 'repo')], template);
    await configureIdentity(path.join(template, 'repo'));
    fs.rmSync(author, { recursive: true, force: true });
  }, 120_000);

  afterAll(async () => {
    await removeDir(template);
  });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-checkout-'));
    fs.cpSync(template, root, { recursive: true });
    originDir = path.join(root, 'origin.git');
    forkDir = path.join(root, 'alice-fork.git');
    repoDir = path.join(root, 'repo');
    await git(['remote', 'set-url', 'origin', originDir], repoDir);
  });

  afterEach(async () => {
    await removeDir(root);
  });

  const fixTypo = (overrides: Record<string, unknown> = {}) => ({
    number: 1,
    headRef: 'fix-typo',
    headOwner: 'alice',
    headCloneUrl: forkDir,
    maintainerCanModify: true,
    baseRemote: 'origin',
    ...overrides,
  });
  const forkMain = (overrides: Record<string, unknown> = {}) => ({
    number: 2,
    headRef: 'main',
    headOwner: 'alice',
    headCloneUrl: forkDir,
    maintainerCanModify: true,
    baseRemote: 'origin',
    ...overrides,
  });

  /** A lane-style checkout of `branch` with one new commit in it. */
  async function commitInLane(branch: string): Promise<{ lane: string; sha: string }> {
    const lane = path.join(root, `lane-${branch.replace(/\//g, '-')}`);
    await git(['worktree', 'add', lane, branch], repoDir);
    await git(['commit', '--allow-empty', '-m', 'maintainer follow-up'], lane);
    return { lane, sha: await git(['rev-parse', 'HEAD'], lane) };
  }

  describe('planPullRequestBranch', () => {
    it('names the branch after the PR head branch', async () => {
      expect(await planPullRequestBranch({ repoPath: repoDir, pullRequest: fixTypo() })).toEqual({
        success: true,
        data: { branchName: 'fix-typo' },
      });
    });

    it("names it <owner>/<head> when the head branch has the default branch's name", async () => {
      expect(await planPullRequestBranch({ repoPath: repoDir, pullRequest: forkMain() })).toEqual({
        success: true,
        data: { branchName: 'alice/main' },
      });
    });

    it('names it <owner>/<head> when a local branch already has that name for something else', async () => {
      await git(['branch', 'fix-typo', 'main'], repoDir);

      expect(await planPullRequestBranch({ repoPath: repoDir, pullRequest: fixTypo() })).toEqual({
        success: true,
        data: { branchName: 'alice/fix-typo' },
      });
    });

    it('refuses with branch_exists when both names are taken', async () => {
      await git(['branch', 'fix-typo', 'main'], repoDir);
      await git(['branch', 'alice/fix-typo', 'main'], repoDir);

      const result = await planPullRequestBranch({ repoPath: repoDir, pullRequest: fixTypo() });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('branch_exists');
    });
  });

  describe('checkOutPullRequestBranch', () => {
    it("fetches the PR's pull ref into the branch without switching the user's checkout", async () => {
      const result = await checkOutPullRequestBranch({
        repoPath: repoDir,
        pullRequest: fixTypo(),
        branchName: 'fix-typo',
      });

      expect(result.success).toBe(true);
      expect(await git(['rev-parse', 'refs/heads/fix-typo'], repoDir)).toBe(fixTypoSha);
      expect(await git(['branch', '--show-current'], repoDir)).toBe('main');
    });

    it('tracks the fork when it accepts maintainer pushes, and a push updates the PR', async () => {
      // A failure names its cause (a fetch under load), not a later git error (devstation-ce5).
      expect(
        await checkOutPullRequestBranch({
          repoPath: repoDir,
          pullRequest: fixTypo(),
          branchName: 'fix-typo',
        })
      ).toMatchObject({ success: true });

      expect(await git(['remote', 'get-url', 'alice'], repoDir)).toBe(forkDir);
      expect(await git(['rev-parse', '--abbrev-ref', 'fix-typo@{upstream}'], repoDir)).toBe(
        'alice/fix-typo'
      );

      const { lane, sha } = await commitInLane('fix-typo');
      const ctx = new LocalExecutionContext({ root: lane });
      const pushed = await push(ctx, ctx);

      expect(pushed.success).toBe(true);
      expect(await git(['rev-parse', 'refs/heads/fix-typo'], forkDir)).toBe(sha);
    });

    it("pushes to the fork's head branch even when the local name differs", async () => {
      const planned = await planPullRequestBranch({ repoPath: repoDir, pullRequest: forkMain() });
      expect(planned).toEqual({ success: true, data: { branchName: 'alice/main' } });
      // A failure names its cause (a fetch under load), not a later git error (devstation-ce5).
      expect(
        await checkOutPullRequestBranch({
          repoPath: repoDir,
          pullRequest: forkMain(),
          branchName: 'alice/main',
        })
      ).toMatchObject({ success: true });
      expect(await git(['rev-parse', 'refs/heads/alice/main'], repoDir)).toBe(forkMainSha);

      const { lane, sha } = await commitInLane('alice/main');
      const ctx = new LocalExecutionContext({ root: lane });
      const pushed = await push(ctx, ctx);

      expect(pushed.success).toBe(true);
      expect(await git(['rev-parse', 'refs/heads/main'], forkDir)).toBe(sha);
      expect(await refExists(forkDir, 'refs/heads/alice/main')).toBe(false);
      // The base repository's own default branch is untouched.
      expect(await refExists(originDir, 'refs/heads/alice/main')).toBe(false);
    });

    it('reuses a remote that already points at the fork', async () => {
      await git(['remote', 'add', 'contrib', forkDir], repoDir);

      // A failure names its cause (a fetch under load), not a later git error (devstation-ce5).

      expect(
        await checkOutPullRequestBranch({
          repoPath: repoDir,
          pullRequest: fixTypo(),
          branchName: 'fix-typo',
        })
      ).toMatchObject({ success: true });

      expect(await git(['rev-parse', '--abbrev-ref', 'fix-typo@{upstream}'], repoDir)).toBe(
        'contrib/fix-typo'
      );
      expect((await git(['remote'], repoDir)).split('\n').sort()).toEqual(['contrib', 'origin']);
    });

    it("keeps gh's pull-ref config for a fork that refuses maintainer pushes, and refuses a push", async () => {
      const result = await checkOutPullRequestBranch({
        repoPath: repoDir,
        pullRequest: fixTypo({ maintainerCanModify: false }),
        branchName: 'fix-typo',
      });

      expect(result.success).toBe(true);
      expect(await git(['rev-parse', 'refs/heads/fix-typo'], repoDir)).toBe(fixTypoSha);
      expect(await git(['config', 'branch.fix-typo.remote'], repoDir)).toBe('origin');
      expect(await git(['config', 'branch.fix-typo.merge'], repoDir)).toBe('refs/pull/1/head');
      expect(await git(['remote'], repoDir)).toBe('origin');

      const { lane } = await commitInLane('fix-typo');
      const ctx = new LocalExecutionContext({ root: lane });
      const pushed = await push(ctx, ctx);
      const published = await publishBranch(ctx, ctx, 'fix-typo');

      for (const outcome of [pushed, published]) {
        expect(outcome.success).toBe(false);
        if (outcome.success) continue;
        expect(outcome.error.type).toBe('fork_push_refused');
        expect(outcome.error.message).toMatch(/maintainer/i);
      }
      // Nothing was published anywhere the PR would not see.
      expect(await refExists(originDir, 'refs/heads/fix-typo')).toBe(false);
      expect(await git(['rev-parse', 'refs/heads/fix-typo'], forkDir)).toBe(fixTypoSha);
    });

    it('checks out a PR whose fork was deleted through the pull ref, and refuses a push', async () => {
      const result = await checkOutPullRequestBranch({
        repoPath: repoDir,
        pullRequest: fixTypo({ headCloneUrl: null, maintainerCanModify: false }),
        branchName: 'fix-typo',
      });

      expect(result.success).toBe(true);
      expect(await git(['rev-parse', 'refs/heads/fix-typo'], repoDir)).toBe(fixTypoSha);

      const { lane } = await commitInLane('fix-typo');
      const ctx = new LocalExecutionContext({ root: lane });
      const pushed = await push(ctx, ctx);
      expect(pushed.success).toBe(false);
      if (!pushed.success) expect(pushed.error.type).toBe('fork_push_refused');
      expect(await refExists(originDir, 'refs/heads/fix-typo')).toBe(false);
    });

    it('refuses with pull_ref_not_found when origin has no such PR, creating no branch', async () => {
      const result = await checkOutPullRequestBranch({
        repoPath: repoDir,
        pullRequest: fixTypo({ number: 99 }),
        branchName: 'fix-typo',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('pull_ref_not_found');
      expect(await refExists(repoDir, 'refs/heads/fix-typo')).toBe(false);
    });
  });
});
