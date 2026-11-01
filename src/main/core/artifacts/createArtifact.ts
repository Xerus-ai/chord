import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ArtifactType } from '@shared/stream-items';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';
import { findWorkItemRepoPath } from './artifact-file-path';
import { artifactRegisterPayload } from './artifact-register-payload';
import { inferArtifactType } from './artifact-utils';

/**
 * A row written before ingestion translated agent paths holds the MSYS
 * rendering the agent reported (`/tmp/repo/plan.md`); the same file now arrives
 * as the real Windows path. Left alone, the insert below would add a second
 * artifact for one file and the work item would show it twice. Repair the
 * stale row instead — skipped when a correctly-pathed row already exists, since
 * the (work_item_id, file_path) index would reject the update.
 */
function repairStaleArtifactPath(workItemId: string, filePath: string): void {
  const rows = db
    .select({ id: artifacts.id, filePath: artifacts.filePath })
    .from(artifacts)
    .where(eq(artifacts.workItemId, workItemId))
    .all();
  if (rows.some((row) => row.filePath === filePath)) return;

  const repoPath = findWorkItemRepoPath(workItemId);
  const stale = rows.find((row) => resolveAgentReportedPath(row.filePath, repoPath) === filePath);
  if (!stale) return;

  db.update(artifacts).set({ filePath }).where(eq(artifacts.id, stale.id)).run();
}

export function createArtifact(args: {
  id?: string;
  workItemId: string;
  filePath: string;
  name: string;
  type?: ArtifactType;
  content?: string;
}): { id: string; artifact: typeof artifacts.$inferSelect | null } {
  const id = args.id ?? randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const type = args.type ?? inferArtifactType(args.filePath);

  repairStaleArtifactPath(args.workItemId, args.filePath);

  db.insert(artifacts)
    .values({
      id,
      workItemId: args.workItemId,
      filePath: args.filePath,
      name: args.name,
      type,
      contentType: type,
      content: args.content ?? '',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  const [row] = db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.workItemId, args.workItemId), eq(artifacts.filePath, args.filePath)))
    .limit(1)
    .all();

  // Register the artifact's work-item binding with the cloud so the sync
  // server can authorize its collaboration document (drains when signed in).
  if (row && !row.syncedAt) {
    syncQueueService.enqueueArtifactCreate(row.id, artifactRegisterPayload(row));
  }

  return { id: row?.id ?? id, artifact: row ?? null };
}
