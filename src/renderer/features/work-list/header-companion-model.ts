import type { Worktree } from '@shared/worktrees';

/** The companion checkout of the lane in focus, if it has one. */
export function focusedLaneCompanion(
  worktrees: readonly Worktree[],
  focusedWorktreeId: string | null
): string | null {
  return worktrees.find((worktree) => worktree.id === focusedWorktreeId)?.companionPath ?? null;
}

/** The last folder of a path, either separator. */
export function companionChipLabel(companionPath: string): string {
  return (
    companionPath
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? companionPath
  );
}
