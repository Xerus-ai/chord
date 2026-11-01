import { EXTENSION_BY_MIME_TYPE, fileViewerForMimeType } from '@shared/artifact-file-types';
import { fetchCloudArtifactView } from '@main/core/artifact-pages/cloud-page-view';
import { cloudFetch } from '@main/core/work-items/cloud-work-items-client';
import { readCloudArtifactFile, type CloudArtifactFile } from './cloud-artifact-file';
import type { LoadedArtifactFile } from './prepare-local-artifact-file';
import { registerPreparedFile, type PreparedArtifactFile } from './prepared-artifact-file';

/** Up to 8 MiB of bytes as base64; the default request timeout is sized for small JSON. */
const FILE_FETCH_TIMEOUT_MS = 120_000;

async function fetchCloudArtifactFile(args: {
  workItemId: string;
  artifactId: string;
  versionId?: string;
}): Promise<CloudArtifactFile> {
  const query = args.versionId ? `?version_id=${encodeURIComponent(args.versionId)}` : '';
  const response = await cloudFetch(
    `/work-items/${encodeURIComponent(args.workItemId)}/artifacts/${encodeURIComponent(args.artifactId)}/file${query}`,
    undefined,
    FILE_FETCH_TIMEOUT_MS
  );
  return readCloudArtifactFile(response);
}

/** The name a file is shown and saved under: the artifact's name with its extension. */
function fileNameFor(name: string, extension: string): string {
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

/**
 * A binary artifact's uploaded bytes (design 2026-09-24 §10 "Desktop"): the
 * latest version that has them, or the named one. No shared copy yet is
 * `ArtifactFileMissingError`.
 */
export async function loadCloudArtifactFile(args: {
  workItemId: string;
  artifactId: string;
  name: string;
  versionId?: string;
}): Promise<LoadedArtifactFile & { versionId: string }> {
  const file = await fetchCloudArtifactFile(args);
  return {
    fileName: fileNameFor(args.name, EXTENSION_BY_MIME_TYPE[file.mimeType]),
    mimeType: file.mimeType,
    bytes: file.bytes,
    versionId: file.versionId,
    versionNumber: file.versionNumber,
    diskPath: null,
  };
}

/**
 * A binary artifact viewed off its author's device: the uploaded bytes, and
 * for an image or docx the view uploaded with that same version. The view
 * route's `no_view` for a version that has bytes but no view is a server fault
 * and propagates.
 */
export async function prepareCloudArtifactFile(args: {
  workItemId: string;
  artifactId: string;
  name: string;
  versionId?: string;
}): Promise<PreparedArtifactFile> {
  const file = await loadCloudArtifactFile(args);
  const view =
    fileViewerForMimeType(file.mimeType) === 'view'
      ? (
          await fetchCloudArtifactView({
            workItemId: args.workItemId,
            artifactId: args.artifactId,
            versionId: file.versionId,
          })
        ).html
      : null;
  return registerPreparedFile({
    artifactId: args.artifactId,
    versionKey: file.versionId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    bytes: file.bytes,
    versionId: file.versionId,
    versionNumber: file.versionNumber,
    view,
  });
}
