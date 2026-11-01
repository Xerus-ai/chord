import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Every checked-out branch and the worktree it is checked out in — the main
 * checkout included. Git allows a branch in one worktree at a time, so this is
 * what decides whether a lane may check a branch out.
 */
export async function listBranchCheckouts(ctx: IExecutionContext): Promise<Map<string, string>> {
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['worktree', 'list', '--porcelain']);
  const checkouts = new Map<string, string>();
  for (const block of stdout.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'));
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    if (!branchLine || !worktreeLine) continue;
    const rawPath = worktreeLine.slice('worktree '.length);
    // Git prints forward slashes even on Windows; local callers compare
    // against native paths. SSH contexts are POSIX — left as-is.
    checkouts.set(
      branchLine.slice('branch refs/heads/'.length),
      ctx.supportsLocalSpawn ? path.resolve(rawPath) : rawPath
    );
  }
  return checkouts;
}

/** Where `branch` is checked out, if anywhere — the main checkout included. */
export async function findBranchCheckout(
  ctx: IExecutionContext,
  branch: string
): Promise<string | undefined> {
  return (await listBranchCheckouts(ctx)).get(branch);
}
