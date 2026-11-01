import { and, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { workItemWorktrees } from '@main/db/schema-work-items';

/** How many of `rows` belong to each work item; an item with none has no entry. */
export function countByWorkItem(rows: readonly { workItemId: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.workItemId, (counts.get(row.workItemId) ?? 0) + 1);
  return counts;
}

/**
 * Each work item's archived lanes, counted: the sidebar lists them under the
 * item as "Archived (n)" (plan §"Decisions for Phase 5", Restore).
 */
export async function readArchivedLaneCounts(ids: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ workItemId: workItemWorktrees.workItemId })
    .from(workItemWorktrees)
    .where(
      and(inArray(workItemWorktrees.workItemId, ids), isNotNull(workItemWorktrees.archivedAt))
    );
  return countByWorkItem(rows);
}
