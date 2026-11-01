import { eq } from 'drizzle-orm';
import { resolveMainRepoPath } from '@main/core/work-items/work-item-worktree-git';
import { db } from '@main/db/client';
import { repos, type WorkItemRow, type WorkItemWorktreeRow } from '@main/db/schema-work-items';

/**
 * The main repo path is `repos.path` when the work item has a `repos` row.
 * Pre-repo-picker work items (and repos that were later removed, which sets
 * `work_items.repo_id` to null via `ON DELETE SET NULL`) have none, so the
 * only place left to derive it from is one of the work item's own worktree
 * checkouts — same approach `removeWorkItemWorktree` uses to find the main
 * checkout from a linked one. Any worktree of the work item works for this,
 * not just the primary: `git rev-parse --git-common-dir` resolves to the same
 * main checkout regardless of which linked worktree it is run from.
 *
 * Split into its own module (rather than living in `worktrees/service.ts`,
 * where it originated) so both `service.ts` and `workspace-bridge.ts` can
 * import it without creating a cycle: `service.ts` already imports
 * `work-item-crud.ts`, and `work-item-crud.ts` calls into
 * `workspace-bridge.ts` to acquire/release a workspace on create/delete.
 */
export async function resolveMainRepoPathForWorkItem(
  workItem: WorkItemRow,
  worktree: Pick<WorkItemWorktreeRow, 'path'>
): Promise<string> {
  if (!workItem.repoId) return resolveMainRepoPath(worktree.path);

  const [repo] = await db.select().from(repos).where(eq(repos.id, workItem.repoId)).limit(1);
  if (!repo) {
    throw new Error(
      `Work item ${workItem.id} references repo ${workItem.repoId}, which no longer exists`
    );
  }
  return repo.path;
}
