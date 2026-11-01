import { err, ok, type Result } from '@shared/result';

/**
 * Which checkout a work item's file read, diff, stage, or restore runs in.
 * Pure (the caller fetches the worktree row) so it is unit-testable without
 * `@main/db/client`, whose better-sqlite3 build targets Electron's ABI — same
 * split as `worktrees/decisions.ts`.
 */

export type WorktreePathError =
  | { type: 'worktree_not_found'; worktreeId: string }
  | { type: 'worktree_archived'; worktreeId: string };

interface WorktreeRowShape {
  id: string;
  workItemId: string;
  path: string;
  archivedAt: number | null;
}

/**
 * No `worktreeId` means the work item's own `repoPath` — its primary worktree.
 * A worktree id must name a live worktree owned by this work item: a tab can
 * outlive its worktree, and an id from another work item must never widen
 * what the renderer can read or mutate.
 */
export function pickWorktreePath(
  workItem: { id: string; repoPath: string },
  worktreeId: string | undefined,
  worktree: WorktreeRowShape | undefined
): Result<string, WorktreePathError> {
  if (worktreeId === undefined) return ok(workItem.repoPath);
  if (!worktree || worktree.id !== worktreeId || worktree.workItemId !== workItem.id) {
    return err({ type: 'worktree_not_found' as const, worktreeId });
  }
  if (worktree.archivedAt !== null) return err({ type: 'worktree_archived' as const, worktreeId });
  return ok(worktree.path);
}
