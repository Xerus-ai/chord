import { eq } from 'drizzle-orm';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { resolveStoredArtifactPath } from './artifact-file-path';
import { artifactRegisterPayload } from './artifact-register-payload';
import type { ArtifactStatus } from './artifact-utils';

/**
 * Sets an artifact's status, and re-registers it with the cloud so teammates
 * see the change (devstation-664): the register is an idempotent upsert, and a
 * register still queued merges with this one.
 */
export async function updateArtifactStatus(id: string, status: ArtifactStatus) {
  const now = Math.floor(Date.now() / 1000);
  await db.update(artifacts).set({ status, updatedAt: now }).where(eq(artifacts.id, id));
  const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
  if (!row) return null;
  syncQueueService.enqueueArtifactCreate(row.id, artifactRegisterPayload(row));
  return { ...row, filePath: resolveStoredArtifactPath(row.filePath, row.workItemId) };
}
