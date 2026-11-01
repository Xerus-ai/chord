import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { prSyncEngine } from '@main/core/pull-requests/pr-sync-engine';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { deleteWorkItem } from '@main/core/work-items/work-item-crud';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { workItems } from '@main/db/schema-work-items';
import { capture } from '@main/lib/telemetry';

export async function deleteProject(id: string): Promise<void> {
  // Per-item deletion so checkpoint refs are released and cloud deletes are
  // enqueued for each work item — a bulk row delete skips both.
  const rows = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.repoId, id));
  // Attempt every item before failing: aborting on the first error left the
  // project half-deleted with no way to converge. Deleting the remaining
  // items keeps the operation retryable — the project row below is only
  // removed once every child is gone, so a retry resumes where this stopped.
  const failures: string[] = [];
  for (const row of rows) {
    const result = await deleteWorkItem(row.id);
    if (!result.success) {
      failures.push(`${row.id} (${result.error.type})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `deleteProject: ${failures.length}/${rows.length} work item cleanups failed — project row kept for retry: ${failures.join(', ')}`
    );
  }
  await prSyncEngine.deleteProjectData(id);
  await db.delete(projects).where(eq(projects.id, id));
  void viewStateService.del(`project:${id}`);
  await projectManager.closeProject(id);
  capture('project_deleted', { project_id: id });
}
