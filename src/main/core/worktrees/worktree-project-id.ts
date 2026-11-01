import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { resolveMainRepoPathForWorkItem } from './repo-path';
import { findWorktreeRow } from './worktree-lookup';

/**
 * The `projectId` a worktree's workspace is registered under — the first
 * argument every `git.*` RPC for that worktree takes. Same derivation as
 * `acquireWorktreeWorkspaceOnce` in `workspace-bridge.ts`: the work item's
 * `repoId`, else the main repo path (which only git knows for a repo-less
 * work item, so the renderer can't compute it itself).
 */
export async function resolveWorktreeProjectId(worktreeId: string): Promise<string | null> {
  const row = findWorktreeRow(worktreeId);
  if (!row) return null;
  const [workItem] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, row.workItemId))
    .limit(1);
  if (!workItem) {
    throw new Error(`Worktree ${row.id} references missing work item ${row.workItemId}`);
  }
  return workItem.repoId ?? (await resolveMainRepoPathForWorkItem(workItem, row));
}
