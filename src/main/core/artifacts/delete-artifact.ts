import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { log } from '@main/lib/logger';
import { deleteCloudArtifact } from './cloud-artifacts-client';
import { stopWatchingArtifactFile } from './push-to-yjs';

export type DeleteArtifactError =
  | { type: 'not_found'; message: string }
  | { type: 'cloud_refused'; message: string; status: number };

/**
 * Deletes an artifact for everyone (P6). The cloud goes first: if it refuses
 * (not the author, offline), nothing is deleted locally and the caller sees
 * why. Then the artifact's queued registration is dropped and the local row
 * is removed — comments, versions, source hashes and the Confluence
 * publication record cascade. The file itself stays in the repository; a
 * published Confluence page stays in Confluence.
 */
export async function deleteArtifact(id: string): Promise<Result<void, DeleteArtifactError>> {
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
  if (!artifact) return err({ type: 'not_found', message: `Artifact ${id} not found` });

  if (artifact.syncedAt !== null) {
    const result = await deleteCloudArtifact(artifact.workItemId, id);
    if (!result.ok) {
      log.warn('[artifacts] cloud refused delete', { id, status: result.status });
      return err({
        type: 'cloud_refused',
        status: result.status,
        message: cloudRefusalMessage(result.status, result.body),
      });
    }
  }

  syncQueueService.purgeArtifactOperations(id);
  stopWatchingArtifactFile(id);
  db.delete(artifacts).where(eq(artifacts.id, id)).run();
  return ok(undefined);
}

function cloudRefusalMessage(status: number, body: string): string {
  if (status === 403) return 'Only the author can delete this artifact.';
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON: report the status below.
  }
  return `The sync server refused the delete (${status}).`;
}
