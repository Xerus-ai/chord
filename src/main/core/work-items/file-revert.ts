import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { enqueueRepoIndexOp } from './git-index-queue';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, {
    cwd: repoPath,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout;
}

/**
 * Paths whose index entry differs from HEAD — a `git checkout -- <file>` on
 * these would only partially revert.
 *
 * `--no-renames` because rename detection names only the destination of a
 * staged rename: without it the source path looks unstaged and the Changes tab
 * offers a one-click revert that cannot restore it.
 */
export async function getStagedPaths(repoPath: string): Promise<Set<string>> {
  const stdout = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-only',
    '--cached',
    '--no-renames',
  ]);
  return new Set(stdout.split('\n').filter(Boolean));
}

function assertInsideRepo(repoPath: string, filePath: string): void {
  const resolved = path.resolve(repoPath, filePath);
  const relative = path.relative(path.resolve(repoPath), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path resolves outside the repo: ${filePath}`);
  }
}

/** True when HEAD holds a blob at this path — the state a discard restores to. */
export async function existsInHead(repoPath: string, filePath: string): Promise<boolean> {
  const stdout = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'ls-tree',
    '--name-only',
    'HEAD',
    '--',
    filePath,
  ]);
  return stdout.split('\n').filter(Boolean).includes(filePath);
}

/**
 * Drops every change to one file — staged and unstaged alike — leaving it as
 * HEAD has it. A path absent from HEAD has no HEAD state to return to, so it
 * leaves the index and the worktree entirely.
 *
 * `git restore <path>` is NOT a substitute: it rewrites the worktree from the
 * index, so it does nothing to a file that was just staged and fails outright
 * on an untracked one.
 */
export async function discardWorkItemFileChanges(
  repoPath: string,
  filePath: string
): Promise<void> {
  assertInsideRepo(repoPath, filePath);
  const tracked = await existsInHead(repoPath, filePath);

  await enqueueRepoIndexOp(repoPath, async () => {
    if (tracked) {
      await runGit(repoPath, ['checkout', 'HEAD', '--', filePath]);
      return;
    }

    await runGit(repoPath, ['rm', '--cached', '--force', '--ignore-unmatch', '--', filePath]);
    await rm(path.resolve(repoPath, filePath), { force: true });
  });
}

/** Stages one file — "Apply All" in the diff viewer. */
export async function stageWorkItemFile(repoPath: string, filePath: string): Promise<void> {
  assertInsideRepo(repoPath, filePath);
  await enqueueRepoIndexOp(repoPath, () => runGit(repoPath, ['add', '--', filePath]));
}

/**
 * One-click discard for a single changed file in the owner Changes tab.
 * Files with staged changes are rejected — the row's revert icon promises to
 * throw away what the row shows, and on a partially staged file a HEAD restore
 * would also silently drop staged work the row never mentioned. The UI hides
 * the revert icon for staged files; this re-check is the server-side
 * guarantee. Callers that mean to drop staged work too call
 * discardWorkItemFileChanges directly.
 */
export async function revertWorkItemFile(repoPath: string, filePath: string): Promise<void> {
  assertInsideRepo(repoPath, filePath);

  const staged = await getStagedPaths(repoPath);
  if (staged.has(filePath)) {
    throw new Error(`revertWorkItemFile: ${filePath} has staged changes — revert would be partial`);
  }

  await discardWorkItemFileChanges(repoPath, filePath);
}
