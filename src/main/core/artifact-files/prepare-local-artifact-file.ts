import { and, eq } from 'drizzle-orm';
import { mimeTypeForArtifactFile, type ArtifactFileMimeType } from '@shared/artifact-file-types';
import { renderClassForArtifactType } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import { resolveArtifactRuntimeDir } from '@main/core/artifact-pages/artifact-runtime-dir';
import { resolveStoredArtifactPath } from '@main/core/artifacts/artifact-file-path';
import { extractFileName } from '@main/core/artifacts/artifact-utils';
import { getArtifact } from '@main/core/artifacts/getArtifact';
import { db } from '@main/db/client';
import { artifactVersions } from '@main/db/schema-artifacts';
import { buildFileView } from './build-file-view';
import { registerPreparedFile, type PreparedArtifactFile } from './prepared-artifact-file';
import { readArtifactFileBytes } from './read-artifact-file-bytes';

/** A binary artifact's bytes on the author's device, and what they are. */
export interface LoadedArtifactFile {
  fileName: string;
  mimeType: ArtifactFileMimeType;
  bytes: Buffer;
  versionId: string | null;
  versionNumber: number | null;
  /** The file itself when these are its current bytes on this device; null for a stored copy. */
  diskPath: string | null;
}

/**
 * The file as it is on disk now, or a saved version's bytes (a file version's
 * `content` is its base64).
 */
export async function loadLocalArtifactFile(args: {
  artifactId: string;
  versionId?: string;
}): Promise<LoadedArtifactFile> {
  const artifact = await getArtifact(args.artifactId);
  if (!artifact) throw new Error(`Artifact not found: ${args.artifactId}`);
  if (renderClassForArtifactType(artifact.type as ArtifactType) !== 'file') {
    throw new Error(`${artifact.name} is not a file`);
  }
  if (!artifact.filePath) throw new Error(`Artifact ${args.artifactId} has no file`);
  const fileName = extractFileName(artifact.filePath);

  let bytes: Buffer;
  let versionNumber: number | null = null;
  let diskPath: string | null = null;
  if (args.versionId) {
    const [version] = db
      .select({ content: artifactVersions.content, versionNumber: artifactVersions.versionNumber })
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.id, args.versionId),
          eq(artifactVersions.artifactId, args.artifactId)
        )
      )
      .all();
    if (!version) throw new Error(`Version ${args.versionId} of ${fileName} not found`);
    bytes = Buffer.from(version.content, 'base64');
    versionNumber = version.versionNumber;
  } else {
    diskPath = resolveStoredArtifactPath(artifact.filePath, artifact.workItemId);
    bytes = readArtifactFileBytes(diskPath).bytes;
  }

  return {
    fileName,
    mimeType: mimeTypeForArtifactFile(artifact.filePath),
    bytes,
    versionId: args.versionId ?? null,
    versionNumber,
    diskPath,
  };
}

/**
 * The author's own view of a binary artifact. The view of an image or docx is
 * built here from the local bytes, exactly as publish builds the one it
 * uploads.
 */
export async function prepareLocalArtifactFile(args: {
  artifactId: string;
  versionId?: string;
}): Promise<PreparedArtifactFile> {
  const file = await loadLocalArtifactFile(args);
  const view = await buildFileView({
    fileName: file.fileName,
    mimeType: file.mimeType,
    bytes: file.bytes,
    runtimeDir: resolveArtifactRuntimeDir(),
  });
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
