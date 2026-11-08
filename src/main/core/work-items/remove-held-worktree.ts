import { readdir, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * `git worktree remove`, for a checkout something may hold for a moment. On
 * Windows a folder that a process has as its cwd, or has open, cannot be
 * deleted: right after a lane's view closes, its reads can still be finishing,
 * and git fails "failed to delete '<folder>': Permission denied", sometimes
 * after it already removed the files, the `.git` file and the registration.
 * A hold is retried for a bounded time; a folder git left empty is removed by
 * itself, never one that still holds anything. Anything else, or a hold that
 * outlasts the bound, throws.
 */

const HOLD_TIMEOUT_MS = 10_000;
const HOLD_POLL_MS = 250;
const HELD_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

function isFolderHeld(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && HELD_CODES.has(code)) return true;
  return /failed to delete '[^']*': (Permission denied|Directory not empty)/.test(String(error));
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** `.git` is a file in a linked worktree. Only a missing one means "not linked"; any other error throws. */
async function isLinkedWorktree(folder: string): Promise<boolean> {
  try {
    return (await stat(path.join(folder, '.git'))).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** What a removal refused to touch: the folder still holds entries git did not get to. */
export class WorktreeLeftoverError extends Error {
  constructor(
    readonly folder: string,
    readonly entries: string[]
  ) {
    super(
      `${folder} was left holding ${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', …' : ''} after git removed the checkout; it was kept.`
    );
  }
}

/**
 * The folder a held `worktree remove` left behind, removed only if it is
 * empty (a plain rmdir, which a hold still fails as held). A folder that
 * holds anything is kept and named: git stops at the first entry it cannot
 * delete, so what is left is not known to be the checkout's to lose.
 */
export async function removeLeftoverFolder(folder: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(folder);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (entries.length > 0) throw new WorktreeLeftoverError(folder, entries);
  await rmdir(folder);
}

export async function removeHeldWorktree(args: {
  /** The main checkout git runs against. */
  repoPath: string;
  worktreePath: string;
  /** `--force`: the checkout's changes go with it (a lane being deleted on purpose). */
  force: boolean;
}): Promise<void> {
  const ctx = new LocalExecutionContext({ root: args.repoPath });
  const deadline = Date.now() + HOLD_TIMEOUT_MS;
  let held = false;
  for (;;) {
    try {
      if (!held || (await isLinkedWorktree(args.worktreePath))) {
        await ctx.exec(GIT_EXECUTABLE, [
          'worktree',
          'remove',
          ...(args.force ? ['--force'] : []),
          args.worktreePath,
        ]);
      } else {
        // The held attempt removed the checkout's `.git` file: what git left goes only if empty.
        await removeLeftoverFolder(args.worktreePath);
      }
      break;
    } catch (error) {
      if (!isFolderHeld(error) || Date.now() >= deadline) throw error;
      held = true;
      await new Promise((resolve) => setTimeout(resolve, HOLD_POLL_MS));
    }
  }
  // A registration whose folder went outside `worktree remove` is pruned.
  await ctx.exec(GIT_EXECUTABLE, ['worktree', 'prune']);
}
