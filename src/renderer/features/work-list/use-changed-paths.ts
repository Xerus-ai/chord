import { useMemo } from 'react';
import {
  useWorktreeProject,
  useWorktreeStatus,
} from '@renderer/features/right-rail/use-worktree-git';
import { useWorkItemWorktrees } from './use-work-item-worktrees';

const NONE: ReadonlySet<string> = new Set();

/**
 * The repo-relative paths with changes in one worktree (undefined: the
 * primary), from the same cached status the Changes panel reads — what decides
 * whether a path tab offers Diff (design 2026-09-26 §3).
 */
export function useChangedPaths(
  workItemId: string,
  worktreeId: string | undefined
): ReadonlySet<string> {
  const worktrees = useWorkItemWorktrees(workItemId);
  const id = worktreeId ?? worktrees?.find((worktree) => worktree.isPrimary)?.id ?? null;
  const project = useWorktreeProject(id);
  const { status } = useWorktreeStatus(project.data, id);
  return useMemo(() => {
    if (!status) return NONE;
    return new Set(
      [...status.staged, ...status.unstaged, ...status.untracked, ...status.conflicts].map(
        (change) => change.path
      )
    );
  }, [status]);
}
