import { eq } from 'drizzle-orm';
import { err, type Result } from '@shared/result';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { workItems, type WorkItemRow } from '@main/db/schema-work-items';
import { pickWorktreePath, type WorktreePathError } from './work-item-worktree-path';

export async function loadWorkItem(workItemId: string): Promise<WorkItemRow | undefined> {
  const [row] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  return row;
}

/** The checkout `worktreeId` names, or the work item's primary worktree when omitted. */
export function resolveCheckoutPath(row: WorkItemRow, worktreeId: string | undefined) {
  return pickWorktreePath(
    row,
    worktreeId,
    worktreeId === undefined ? undefined : findWorktreeRow(worktreeId)
  );
}

/** A work item's checkout for one worktree, from its id — what repo-file reads, writes and previews resolve against. */
export async function resolveWorkItemCheckout(
  workItemId: string,
  worktreeId: string | undefined
): Promise<Result<string, { type: 'not_found' } | WorktreePathError>> {
  const row = await loadWorkItem(workItemId);
  if (!row) return err({ type: 'not_found' as const });
  return resolveCheckoutPath(row, worktreeId);
}
