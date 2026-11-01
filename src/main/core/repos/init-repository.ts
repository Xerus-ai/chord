import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { err, ok, type Result } from '@shared/result';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5000;

export type InitRepositoryError =
  | { type: 'already_git_repo'; message: string }
  | { type: 'init_failed'; message: string };

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync(GIT_EXECUTABLE, args, { cwd, timeout: GIT_TIMEOUT_MS });
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--git-dir'], path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turns a plain folder into a git repository.
 *
 * The empty initial commit is load-bearing, not a courtesy. A fresh `git init`
 * leaves HEAD on an *unborn* branch: `rev-parse --abbrev-ref HEAD` reports a
 * branch name, but `refs/heads/<name>` does not resolve. Provisioning a work
 * item's worktree branches from that ref, so without a commit the very first
 * work item created on a brand-new repository would fail with
 * `branch-not-found` — and the failure would look like a worktree bug rather
 * than an empty repository.
 *
 * Kept free of database imports so it can be tested against real folders.
 */
export async function initGitRepository(path: string): Promise<Result<void, InitRepositoryError>> {
  if (await isGitRepo(path)) {
    return err({
      type: 'already_git_repo' as const,
      message: `${path} is already a git repository — add it instead.`,
    });
  }

  try {
    await git(['init'], path);
  } catch (cause) {
    return err({
      type: 'init_failed' as const,
      message: `Could not create a repository in ${path}: ${String(cause)}`,
    });
  }

  try {
    await git(['commit', '--allow-empty', '-m', 'Initial commit'], path);
  } catch (cause) {
    return err({
      type: 'init_failed' as const,
      message: `Created the repository but could not make its first commit — git needs a user.name and user.email configured. ${String(cause)}`,
    });
  }

  return ok();
}
