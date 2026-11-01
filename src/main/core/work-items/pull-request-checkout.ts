import { resolve } from 'node:path';
import { parseGitHubRepository } from '@shared/github-repository';
import { err, ok, type Result } from '@shared/result';
import type { PullRequestCheckoutError, PullRequestCheckoutSource } from '@shared/work-item-ticket';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { readGitConfig } from '@main/core/git/impl/pull-request-push';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Checking out a PR the way `gh pr checkout` does (cli/cli
 * pkg/cmd/pr/checkout, `cmdsForMissingRemote`): its branch is fetched from the
 * base remote's `refs/pull/<n>/head`, so a fork PR — even one whose fork was
 * deleted — checks out without the fork. A fork that accepts maintainer
 * pushes becomes a remote the branch tracks, so a push updates the PR;
 * otherwise the branch keeps gh's config (`refs/pull/<n>/head`) and a push is
 * refused (`git/impl/pull-request-push.ts`). The user's checkout is never
 * switched: the lane's worktree checks the branch out as any `existingBranch`.
 */

function gitIn(repoPath: string) {
  const ctx = new LocalExecutionContext({ root: repoPath });
  return {
    ctx,
    run: async (args: string[]) => (await ctx.exec(GIT_EXECUTABLE, args)).stdout.trim(),
  };
}

function describe(error: unknown): string {
  const stderr = (error as { stderr?: string } | null)?.stderr;
  return stderr?.trim() || (error instanceof Error ? error.message : String(error));
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const out = await gitIn(repoPath).run([
    'for-each-ref',
    '--format=%(refname)',
    `refs/heads/${branch}`,
  ]);
  return out === `refs/heads/${branch}`;
}

/** A local branch already made for this PR (by Chord or by `gh pr checkout`). */
async function tracksPullRequest(
  repoPath: string,
  branch: string,
  pullRequest: PullRequestCheckoutSource
): Promise<boolean> {
  const { ctx } = gitIn(repoPath);
  const marker = await readGitConfig(ctx, `branch.${branch}.chordPullRequest`);
  if (marker === String(pullRequest.number)) return true;
  const merge = await readGitConfig(ctx, `branch.${branch}.merge`);
  return merge === `refs/pull/${pullRequest.number}/head`;
}

/**
 * The remote whose configured URL is the GitHub repository `owner/repo` — the
 * URL `readCheckoutRemotes` lists PRs by — or null when no remote is.
 */
export async function findRepositoryRemote(
  repoPath: string,
  repository: { owner: string; repo: string }
): Promise<string | null> {
  const { ctx, run } = gitIn(repoPath);
  const wanted = `${repository.owner}/${repository.repo}`.toLowerCase();
  for (const name of (await run(['remote'])).split('\n').filter(Boolean)) {
    const url = await readGitConfig(ctx, `remote.${name}.url`);
    if (parseGitHubRepository(url)?.nameWithOwner.toLowerCase() === wanted) return name;
  }
  return null;
}

/**
 * A remote's default branch: as last recorded (`<remote>/HEAD`), else asked
 * of the remote — a remote added by hand and never fetched has no record, and
 * `git remote set-head --auto` refuses it until its branches are fetched.
 */
async function readRemoteDefaultBranch(
  repoPath: string,
  remote: string
): Promise<Result<string, PullRequestCheckoutError>> {
  const { run } = gitIn(repoPath);
  const recorded = await run(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]).catch(
    () => null
  );
  if (recorded?.startsWith(`${remote}/`)) return ok(recorded.slice(remote.length + 1));
  let answer: string;
  try {
    answer = await run(['ls-remote', '--symref', remote, 'HEAD']);
  } catch (error) {
    return err({
      type: 'error',
      message: `Could not ask ${remote} for its default branch. ${describe(error)}`,
    });
  }
  const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(answer)?.[1];
  if (!branch) return err({ type: 'error', message: `${remote} has no default branch.` });
  return ok(branch);
}

/**
 * The local branch a PR checks out into: its head branch, or
 * `<owner>/<head>` when that would take the default branch's name (gh's rule)
 * or a local branch that already means something else.
 */
export async function planPullRequestBranch(args: {
  repoPath: string;
  pullRequest: PullRequestCheckoutSource;
}): Promise<Result<{ branchName: string }, PullRequestCheckoutError>> {
  const { repoPath, pullRequest } = args;
  const defaultBranch = await readRemoteDefaultBranch(repoPath, pullRequest.baseRemote);
  if (!defaultBranch.success) return defaultBranch;

  const candidates = [pullRequest.headRef, `${pullRequest.headOwner}/${pullRequest.headRef}`];
  for (const [index, candidate] of candidates.entries()) {
    if (index === 0 && candidate === defaultBranch.data) continue;
    if (!(await branchExists(repoPath, candidate))) return ok({ branchName: candidate });
    if (await tracksPullRequest(repoPath, candidate, pullRequest)) {
      return ok({ branchName: candidate });
    }
  }
  return err({
    type: 'branch_exists',
    branch: candidates[1],
    message: `${candidates.join(' and ')} already exist in this repository for something other than PR #${pullRequest.number}.`,
  });
}

/** Two spellings of one remote: GitHub URLs by owner/repo, anything else by path. */
function sameRemote(a: string, b: string): boolean {
  const repoA = parseGitHubRepository(a);
  const repoB = parseGitHubRepository(b);
  if (repoA && repoB)
    return repoA.nameWithOwner.toLowerCase() === repoB.nameWithOwner.toLowerCase();
  const normalize = (url: string) => {
    const resolved = resolve(url.replace(/\/+$/, ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

async function ensureForkRemote(
  repoPath: string,
  pullRequest: PullRequestCheckoutSource,
  cloneUrl: string
): Promise<Result<string, PullRequestCheckoutError>> {
  const { run } = gitIn(repoPath);
  const names = (await run(['remote'])).split('\n').filter(Boolean);
  for (const name of names) {
    if (sameRemote(await run(['remote', 'get-url', name]), cloneUrl)) return ok(name);
  }
  const name = pullRequest.headOwner;
  if (names.includes(name)) {
    return err({
      type: 'remote_name_taken',
      remote: name,
      message: `A remote named ${name} already points somewhere other than ${cloneUrl}, so the PR's fork can't be added under that name.`,
    });
  }
  await run(['remote', 'add', name, cloneUrl]);
  return ok(name);
}

/** Fetches the PR into `branchName` (planned by `planPullRequestBranch`) and sets where it pushes. */
export async function checkOutPullRequestBranch(args: {
  repoPath: string;
  pullRequest: PullRequestCheckoutSource;
  branchName: string;
}): Promise<Result<void, PullRequestCheckoutError>> {
  const { repoPath, pullRequest, branchName } = args;
  const { run } = gitIn(repoPath);
  const { baseRemote } = pullRequest;
  const pullRef = `refs/pull/${pullRequest.number}/head`;

  if (await branchExists(repoPath, branchName)) {
    if (!(await tracksPullRequest(repoPath, branchName, pullRequest))) {
      return err({
        type: 'branch_exists',
        branch: branchName,
        message: `${branchName} already exists in this repository for something other than PR #${pullRequest.number}.`,
      });
    }
  } else {
    try {
      await run(['fetch', '--no-tags', baseRemote, `${pullRef}:refs/heads/${branchName}`]);
    } catch (error) {
      const message = describe(error);
      if (/couldn't find remote ref/i.test(message)) {
        return err({
          type: 'pull_ref_not_found',
          message: `${baseRemote} has no ${pullRef}: PR #${pullRequest.number} isn't on this repository's remote.`,
        });
      }
      return err({ type: 'error', message });
    }
  }

  if (pullRequest.maintainerCanModify && pullRequest.headCloneUrl) {
    const remote = await ensureForkRemote(repoPath, pullRequest, pullRequest.headCloneUrl);
    if (!remote.success) return remote;
    const tracking = `refs/remotes/${remote.data}/${pullRequest.headRef}`;
    try {
      await run([
        'fetch',
        '--no-tags',
        remote.data,
        `refs/heads/${pullRequest.headRef}:${tracking}`,
      ]);
    } catch (error) {
      return err({ type: 'fork_fetch_failed', message: describe(error) });
    }
    // Written key by key rather than `--set-upstream-to=alice/main`, which
    // resolves to the local branch `alice/main` itself. `pushRemote` as gh
    // sets it, so a user's `remote.pushDefault` can't send the push elsewhere.
    await run(['config', `branch.${branchName}.remote`, remote.data]);
    await run(['config', `branch.${branchName}.pushRemote`, remote.data]);
    await run(['config', `branch.${branchName}.merge`, `refs/heads/${pullRequest.headRef}`]);
  } else {
    await run(['config', `branch.${branchName}.remote`, baseRemote]);
    await run(['config', `branch.${branchName}.merge`, pullRef]);
  }
  await run(['config', `branch.${branchName}.chordPullRequest`, String(pullRequest.number)]);
  return ok();
}
