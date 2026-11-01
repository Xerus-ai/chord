import { err, ok, type Result } from '@shared/result';

/**
 * Pure refusal rules for archiving, deleting and promoting a worktree, kept apart from
 * `service.ts` so they can be unit-tested without touching `@main/db/client`
 * — that module loads better-sqlite3's Electron-ABI build, which cannot load
 * under a plain Node test runner (see `db/foreign-keys.test.ts`). `service.ts`
 * calls these against the row it already fetched; nothing here talks to git
 * or the database itself.
 */

export type ArchiveWorktreeError = { type: 'primary_worktree' } | { type: 'already_archived' };

export type PromoteWorktreeError = { type: 'archived' };

export type DeleteWorktreeDecisionError =
  | { type: 'primary_worktree' }
  | { type: 'repo_checkout'; path: string };

export type PromoteWorktreePlan = 'already_primary' | 'promote';

interface WorktreeRowShape {
  isPrimary: boolean;
  archivedAt: number | null;
}

/** The primary worktree can never be archived, and archiving twice is a no-op error, not a re-archive. */
export function planWorktreeArchive(row: WorktreeRowShape): Result<void, ArchiveWorktreeError> {
  if (row.isPrimary) return err({ type: 'primary_worktree' as const });
  if (row.archivedAt !== null) return err({ type: 'already_archived' as const });
  return ok();
}

/**
 * The primary can't be deleted: the work item opens to it and its
 * `repo_path` points at it — promote another lane first, or delete the item.
 * A lane whose path is a repository's own checkout (the registered repo
 * path, or any main checkout) is never removed (plan P22): that folder is
 * the user's, and `git worktree remove` would take it with it.
 */
export function planWorktreeDelete(row: {
  isPrimary: boolean;
  path: string;
  isRepoCheckout: boolean;
}): Result<void, DeleteWorktreeDecisionError> {
  if (row.isPrimary) return err({ type: 'primary_worktree' as const });
  if (row.isRepoCheckout) return err({ type: 'repo_checkout' as const, path: row.path });
  return ok();
}

/** An archived worktree has no checkout left to promote; promoting the current primary is a harmless no-op. */
export function planWorktreePromotion(
  row: WorktreeRowShape
): Result<PromoteWorktreePlan, PromoteWorktreeError> {
  if (row.archivedAt !== null) return err({ type: 'archived' as const });
  if (row.isPrimary) return ok('already_primary');
  return ok('promote');
}
