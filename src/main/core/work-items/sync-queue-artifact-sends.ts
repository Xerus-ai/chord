import { eq } from 'drizzle-orm';
import {
  createCloudArtifact,
  type CloudArtifactCreatePayload,
} from '@main/core/artifacts/cloud-artifacts-client';
import {
  deleteDeviceComments,
  hasDeviceComments,
  importDeviceComments,
} from '@main/core/artifacts/device-comments';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import type { SendResult } from './cloud-work-items-client';
import type { ArtifactCommentImportQueuePayload } from './sync-queue-entities';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Registers an artifact with the cloud and brings along the comments written
 * on this device while it had no cloud id (devstation-85y). The comments card
 * reads the device until the artifact has a cloud id and the cloud after, so
 * the cloud id is stamped only once the comments are there, in the same
 * transaction that drops them from the device. A failed import fails the row
 * and the retry sends both again; both are idempotent server-side.
 *
 * `onDeviceCommentsLeft`: a comment written while the import was in flight is
 * still on the device; the caller queues its own import.
 */
export async function deliverArtifactCreate(
  artifactId: string,
  payload: CloudArtifactCreatePayload,
  onDeviceCommentsLeft: () => void
): Promise<SendResult> {
  const created = await createCloudArtifact(artifactId, payload);
  if (!created.ok) return created;
  const { result, importedIds } = await importDeviceComments(payload.work_item_id, artifactId);
  if (!result.ok) return result;
  db.transaction((tx) => {
    tx.update(artifacts)
      .set({ cloudId: artifactId, syncedAt: nowSeconds() })
      .where(eq(artifacts.id, artifactId))
      .run();
    deleteDeviceComments(tx, artifactId, importedIds);
  });
  if (hasDeviceComments(artifactId)) onDeviceCommentsLeft();
  return { ok: true };
}

/** Imports device comments of an artifact that already synced, then drops them from the device. */
export async function deliverCommentImport(
  payload: ArtifactCommentImportQueuePayload
): Promise<SendResult> {
  const { result, importedIds } = await importDeviceComments(
    payload.work_item_id,
    payload.artifact_id
  );
  if (!result.ok) return result;
  db.transaction((tx) => deleteDeviceComments(tx, payload.artifact_id, importedIds));
  return { ok: true };
}
