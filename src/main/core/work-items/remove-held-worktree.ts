import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * `git worktree remove`, for a checkout something may hold for a moment. On
 * Windows a folder that a process has as its cwd, or has open, cannot be
 * deleted: right after a lane's view closes, its reads can still be finishing,
 * and git fails "failed to delete '<folder>': Permission denied", often after
 * it already removed the files and the registration. A hold is retried for a
 * bounded time; a folder git emptied and unregistered is removed by itself.
 * Anything else, or a hold that outlasts the bound, throws.
 */

const HOLD_TIMEOUT_MS = 10_000;
const HOLD_POLL_MS = 250;
const HELD_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

function isFolderHeld(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && HELD_CODES.has(code)) return true;
  return /failed to delete '[^']*': (Permission denied|Directory not empty)/.test(String(error));
}

async function isLinkedWorktree(folder: string): Promise<boolean> {
  try {
    return (await stat(path.join(folder, '.git'))).isFile();
  } catch {
    return false;
  }
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
        // The held attempt removed the checkout's files and its `.git` file; only the folder was left.
        await rm(args.worktreePath, { recursive: true, force: true });
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
