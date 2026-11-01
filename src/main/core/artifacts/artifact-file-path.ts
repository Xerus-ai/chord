import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';

/**
 * Read-time translation for artifact paths.
 *
 * An artifact row records the path the agent reported when it wrote the file.
 * Rows written before ingestion translated those paths — and rows whose write
 * Chord never observed — hold the MSYS rendering the agent printed
 * (`/tmp/repo/plan.md` for a repo under `%TEMP%`). On Windows `/tmp/...` is a
 * valid absolute path, so nothing anchors it to the repo: the reader resolves
 * it against the current drive, opens nothing at `C:\tmp\repo\plan.md`, and the
 * editor renders blank. Every read of a stored path is translated against the
 * work item's repo directory before anyone opens, watches, or bundles it.
 */

/** The repo directory the work item's paths are anchored on. */
export function findWorkItemRepoPath(workItemId: string | null | undefined): string | null {
  if (!workItemId) return null;
  const [row] = db
    .select({ repoPath: workItems.repoPath })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1)
    .all();
  return row?.repoPath ?? null;
}

/** One stored path, translated against its own work item's repo directory. */
export function resolveStoredArtifactPath(
  filePath: string,
  workItemId: string | null | undefined
): string {
  return resolveAgentReportedPath(filePath, findWorkItemRepoPath(workItemId));
}
