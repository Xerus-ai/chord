import type { ArtifactCommentImport } from '@chord/protocol';
import type { ArtifactRenderClass } from '@shared/artifact-render-class';
import {
  cloudFetch,
  toSendResult,
  type SendResult,
} from '@main/core/work-items/cloud-work-items-client';
import type { ArtifactStatus, ArtifactVersionTrigger } from './artifact-utils';

export interface CloudArtifactCreatePayload {
  work_item_id: string;
  name: string;
  content_type: string;
  /** Tells the sync server whether this artifact gets a Yjs room (pages do not). */
  render_class: ArtifactRenderClass;
  /** The owner's status, so a teammate's file bar shows it (devstation-664). */
  status: ArtifactStatus;
}

/**
 * Registers an artifact's metadata (id + work item binding) with the cloud so
 * the sync server can resolve artifact documents to work items for
 * per-document authorization. Idempotent server-side.
 */
export async function createCloudArtifact(
  artifactId: string,
  payload: CloudArtifactCreatePayload
): Promise<SendResult> {
  const res = await cloudFetch(`/work-items/${payload.work_item_id}/artifacts`, {
    method: 'POST',
    body: JSON.stringify({
      id: artifactId,
      name: payload.name,
      content_type: payload.content_type,
      render_class: payload.render_class,
      status: payload.status,
    }),
  });
  const result = await toSendResult(res, false);
  // 403: the caller can only view the work item (requireWorkItemRole('edit')
  // on the register route). A local artifact row under a work item this
  // account does not own cannot be registered from here however often it is
  // retried — fail the row on the first answer, with the server's reason.
  if (!result.ok && result.status === 403) {
    return { ...result, body: `HTTP 403: ${result.body}`, terminal: true };
  }
  return result;
}

/**
 * Carries comments written on this device before the artifact reached the
 * cloud there (devstation-85y). Idempotent server-side by comment id. A body
 * the server refuses cannot be fixed by retrying.
 */
export async function importCloudArtifactComments(
  workItemId: string,
  artifactId: string,
  body: ArtifactCommentImport
): Promise<SendResult> {
  const res = await cloudFetch(
    `/work-items/${workItemId}/artifacts/${artifactId}/comments/import`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  const result = await toSendResult(res, false);
  if (!result.ok && result.status === 400) return { ...result, terminal: true };
  return result;
}

/**
 * Deletes the artifact in the cloud for everyone (author only, server-side).
 * A 404 means it is already gone there — the state the caller asked for.
 */
export async function deleteCloudArtifact(
  workItemId: string,
  artifactId: string
): Promise<SendResult> {
  const res = await cloudFetch(`/work-items/${workItemId}/artifacts/${artifactId}`, {
    method: 'DELETE',
  });
  return toSendResult(res, true);
}

/**
 * One local version, queued for the cloud (design 2026-09-24 §9 "Upload").
 * A page carries its source and its self-contained view; a file carries its
 * bytes and MIME type, plus a view for an image or docx; a document's manual
 * save carries none of these — the server snapshots its live Yjs state.
 */
export interface ArtifactVersionUploadPayload {
  artifact_id: string;
  work_item_id: string;
  /** The local version id: the server answers a repeat with the row it already has. */
  client_version_id: string;
  trigger: Exclude<ArtifactVersionTrigger, 'auto'>;
  label: string | null;
  content?: string;
  view_html?: string;
  /** A file version's bytes (design 2026-09-24 §10), with its MIME type. */
  file_base64?: string;
  mime_type?: string;
}

/** Views are up to 8 MiB; the default 10 s would fail them on a slow uplink forever. */
const VERSION_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Statuses retrying cannot fix: a body the server refuses (validation, too
 * large). They fail the queue row at once instead of after five backoffs.
 */
const REFUSED_UPLOAD_STATUSES = new Set([400, 413, 422]);

export async function uploadCloudArtifactVersion(
  payload: ArtifactVersionUploadPayload
): Promise<SendResult> {
  const res = await cloudFetch(
    `/work-items/${payload.work_item_id}/artifacts/${payload.artifact_id}/versions`,
    {
      method: 'POST',
      body: JSON.stringify({
        client_version_id: payload.client_version_id,
        trigger: payload.trigger,
        // The server takes an absent label, not null (routes/versions.ts).
        label: payload.label ?? undefined,
        content: payload.content,
        view_html: payload.view_html,
        file_base64: payload.file_base64,
        mime_type: payload.mime_type,
      }),
    },
    VERSION_UPLOAD_TIMEOUT_MS
  );
  const result = await toSendResult(res, false);
  if (!result.ok && REFUSED_UPLOAD_STATUSES.has(result.status)) {
    return { ...result, terminal: true };
  }
  return result;
}
