import type { WorktreeArchiveInspection } from '@shared/worktrees';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Git-only half of the archive confirm dialog: how much would be lost if this
 * worktree's checkout were removed right now. Deliberately imports nothing
 * from the database or settings, matching `work-item-worktree-git.ts`, so it
 * can run against a real repository under a plain Node test runner.
 */

interface ExecFailure {
  stderr?: string;
}

function isNoUpstreamFailure(cause: unknown): boolean {
  const stderr = (cause as ExecFailure)?.stderr ?? '';
  // git's exact wording for a branch with no tracking ref, across the
  // versions this app supports on Windows/macOS/Linux.
  return /no upstream configured|does not have any upstream|unknown revision/i.test(stderr);
}

function countPorcelainLines(stdout: string): number {
  return stdout.split('\n').filter((line) => line.trim().length > 0).length;
}

/**
 * `unpushed` is commits ahead of the branch's own upstream, not commits ahead
 * of the work item's base branch — the two only coincide once the branch has
 * been pushed at least once. A worktree with no upstream reports `null`
 * rather than a count against the base branch: the archive dialog's question
 * is "would `git push` need to happen first", and without an upstream there
 * is no push target to be behind, so folding in a base-branch diff would
 * answer a different question than the one being asked.
 */
export async function inspectWorktreeGitState(
  worktreePath: string
): Promise<Pick<WorktreeArchiveInspection, 'uncommitted' | 'unpushed'>> {
  const ctx = new LocalExecutionContext({ root: worktreePath });

  const { stdout: statusOut } = await ctx.exec(GIT_EXECUTABLE, ['status', '--porcelain']);
  const uncommitted = countPorcelainLines(statusOut);

  let unpushed: number | null;
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['rev-list', '--count', '@{upstream}..HEAD']);
    unpushed = Number(stdout.trim());
  } catch (cause) {
    if (!isNoUpstreamFailure(cause)) throw cause;
    unpushed = null;
  }

  return { uncommitted, unpushed };
}
