import { err, ok, type Result } from '@shared/result';
import type { WorkItemWorktreeRow } from '@main/db/schema-work-items';

export type WorktreeValidationError =
  | { type: 'worktree_not_found' }
  | { type: 'worktree_archived' };

/**
 * Pure guard for an explicitly-requested worktree: it must exist, belong to
 * the work item the caller is acting on, and not be archived. Kept free of
 * `@main/db/client` so it can be unit tested under plain Node (the Electron
 * better-sqlite3 build only loads inside the app).
 */
export function validateSessionWorktree(
  row: WorkItemWorktreeRow | undefined,
  workItemId: string
): Result<WorkItemWorktreeRow, WorktreeValidationError> {
  if (!row || row.workItemId !== workItemId) {
    return err({ type: 'worktree_not_found' });
  }
  if (row.archivedAt != null) {
    return err({ type: 'worktree_archived' });
  }
  return ok(row);
}
