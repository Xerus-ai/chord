import { ARTIFACT_COMMENT_IMPORT_BATCH, type ImportedArtifactComment } from '@chord/protocol';
import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';
import type { SendResult } from '@main/core/work-items/cloud-work-items-client';
import { db } from '@main/db/client';
import { artifactComments, artifacts } from '@main/db/schema-artifacts';
import { importCloudArtifactComments } from './cloud-artifacts-client';

/**
 * Comments kept on this device. The device holds an artifact's comments only
 * until the artifact reaches the cloud; from then on the comments card reads
 * and writes the cloud (artifact-comments-store.ts). The delivery that gives
 * an artifact its cloud id imports these first and drops them after
 * (devstation-85y), so none are left behind where nothing reads them.
 */

/** SQLite's bind-parameter limit is 999; delete imported ids in bounded batches. */
const DELETE_BATCH = 500;

/** Whether the artifact has reached the cloud, so the device no longer keeps its comments. */
export function isArtifactInCloud(artifactId: string): boolean {
  const row = db
    .select({ cloudId: artifacts.cloudId })
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .get();
  return row?.cloudId != null;
}

/** The artifact a device comment belongs to, or null when there is no such comment. */
export function artifactOfDeviceComment(commentId: string): string | null {
  const row = db
    .select({ artifactId: artifactComments.artifactId })
    .from(artifactComments)
    .where(eq(artifactComments.id, commentId))
    .get();
  return row?.artifactId ?? null;
}

export function hasDeviceComments(artifactId: string): boolean {
  const row = db
    .select({ n: count() })
    .from(artifactComments)
    .where(eq(artifactComments.artifactId, artifactId))
    .get();
  return (row?.n ?? 0) > 0;
}

/** Synced artifacts that still hold device comments: left behind by builds before the import. */
export function listSyncedArtifactsWithDeviceComments(): {
  artifactId: string;
  workItemId: string;
}[] {
  return db
    .selectDistinct({ artifactId: artifacts.id, workItemId: artifacts.workItemId })
    .from(artifacts)
    .innerJoin(artifactComments, eq(artifactComments.artifactId, artifacts.id))
    .where(isNotNull(artifacts.cloudId))
    .all();
}

function toImportedComment(row: typeof artifactComments.$inferSelect): ImportedArtifactComment {
  return {
    id: row.id,
    parent_comment_id: row.parentCommentId,
    anchor_key: row.anchorKey,
    anchor_text: row.anchorText,
    body: row.body,
    resolved: row.resolved === 1,
    created_at: new Date(row.createdAt * 1000).toISOString(),
  };
}

/**
 * Sends every device comment of the artifact to the cloud. `importedIds` are
 * the comments now in the cloud, for the caller to drop from the device —
 * together with whatever else must change at the same moment (the artifact's
 * cloud id). On a failed batch nothing is reported imported: the retry sends
 * all of them again, which the server answers without duplicating any.
 */
export async function importDeviceComments(
  workItemId: string,
  artifactId: string
): Promise<{ result: SendResult; importedIds: string[] }> {
  const rows = db
    .select()
    .from(artifactComments)
    .where(eq(artifactComments.artifactId, artifactId))
    .all();
  for (let i = 0; i < rows.length; i += ARTIFACT_COMMENT_IMPORT_BATCH) {
    const batch = rows.slice(i, i + ARTIFACT_COMMENT_IMPORT_BATCH);
    const result = await importCloudArtifactComments(workItemId, artifactId, {
      comments: batch.map(toImportedComment),
    });
    if (!result.ok) return { result, importedIds: [] };
  }
  return { result: { ok: true }, importedIds: rows.map((row) => row.id) };
}

export function deleteDeviceComments(
  tx: Pick<typeof db, 'delete'>,
  artifactId: string,
  ids: string[]
): void {
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    tx.delete(artifactComments)
      .where(
        and(
          eq(artifactComments.artifactId, artifactId),
          inArray(artifactComments.id, ids.slice(i, i + DELETE_BATCH))
        )
      )
      .run();
  }
}
