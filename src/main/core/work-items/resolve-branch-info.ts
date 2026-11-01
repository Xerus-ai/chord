import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5_000;

export interface WorkItemBranchInfo {
  /** null only for a detached HEAD — an unreadable repo throws instead. */
  currentBranch: string | null;
  /** The branch a pull request from this work item would target. */
  defaultBranch: string;
}

/**
 * Exit code 1 is git's "the thing you asked about is not configured / does not
 * exist" answer for the `--quiet` query forms below; 128 and friends mean the
 * repo itself is unusable. Only the former is an expected outcome, so only the
 * former turns into `null` — everything else propagates.
 */
async function queryGit(repoPath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, {
      cwd: repoPath,
      timeout: GIT_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}

/**
 * The repo's current branch plus the branch it merges back into.
 *
 * The default branch is whatever the remote says it is; a repo with no
 * `origin/HEAD` (never cloned, or fetched without it) is probed for the two
 * conventional names, and a repo that has neither can only answer with the
 * branch it is on. Those are answers, not fallbacks-on-error: a git failure
 * throws so the caller reports it instead of rendering a guess.
 */
export async function resolveWorkItemBranchInfo(repoPath: string): Promise<WorkItemBranchInfo> {
  // `symbolic-ref HEAD` rather than `rev-parse --abbrev-ref HEAD`: it names the
  // branch of a repo with no commits yet instead of failing on the unborn ref,
  // and its exit-1 case is exactly "detached HEAD".
  const currentBranch = await queryGit(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);

  const originHead = await queryGit(repoPath, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (originHead) {
    const defaultBranch = originHead.includes('/')
      ? (originHead.split('/').pop() ?? originHead)
      : originHead;
    return { currentBranch, defaultBranch };
  }

  for (const candidate of ['main', 'master']) {
    const verified = await queryGit(repoPath, ['rev-parse', '--verify', '--quiet', candidate]);
    if (verified !== null) return { currentBranch, defaultBranch: candidate };
  }

  // Detached HEAD in a repo without either conventional branch: the commit the
  // worktree sits on is the only base that exists.
  return { currentBranch, defaultBranch: currentBranch ?? 'HEAD' };
}
