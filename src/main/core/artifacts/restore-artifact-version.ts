import { writeFileSync } from 'node:fs';
import { and, desc, eq } from 'drizzle-orm';
import { mimeTypeForArtifactFile } from '@shared/artifact-file-types';
import { renderClassForArtifactType } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import { buildFileView } from '@main/core/artifact-files/build-file-view';
import { resolveArtifactRuntimeDir } from '@main/core/artifact-pages/artifact-runtime-dir';
import { db } from '@main/db/client';
import { artifactVersions } from '@main/db/schema-artifacts';
import { extractFileName } from './artifact-utils';
import { getArtifact } from './getArtifact';
import { pushArtifactContentToRenderer } from './push-to-yjs';
import {
  buildArtifactVersionView,
  commitArtifactVersion,
  type FileVersionUpload,
  type RecordArtifactVersionResult,
  type VersionedArtifact,
} from './record-artifact-version';

function latestVersionNumber(artifactId: string): number {
  const [latest] = db
    .select({ versionNumber: artifactVersions.versionNumber })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.versionNumber))
    .limit(1)
    .all();
  return latest?.versionNumber ?? 0;
}

/**
 * Restore (shared-items step 1, S7): an older version of a page or file
 * becomes the newest. The file on disk is put back to that version and the
 * content is saved as a manual version labelled "Restored vN", so it uploads
 * like any manual save. A document is restored through its live editor
 * instead, so every peer in its room sees the change.
 *
 * `baseVersion` is the latest version the user saw. If a newer one has landed
 * since, the restore is a `conflict` and nothing is written. The view is built
 * first (it is async); from the check to the write to the insert nothing
 * awaits, so no other save can land in between, and a failed write stores no
 * version.
 */
export async function restoreArtifactVersion(args: {
  artifactId: string;
  versionId: string;
  baseVersion: number;
  authorName: string;
}): Promise<RecordArtifactVersionResult> {
  const row = await getArtifact(args.artifactId);
  if (!row) throw new Error(`Artifact not found: ${args.artifactId}`);
  const [version] = db
    .select()
    .from(artifactVersions)
    .where(
      and(eq(artifactVersions.id, args.versionId), eq(artifactVersions.artifactId, args.artifactId))
    )
    .limit(1)
    .all();
  if (!version) {
    throw new Error(`${args.versionId} is not a version of artifact ${args.artifactId}`);
  }

  const artifact: VersionedArtifact = {
    id: row.id,
    workItemId: row.workItemId,
    filePath: row.filePath,
    type: row.type as ArtifactType,
  };
  const renderClass = renderClassForArtifactType(artifact.type);
  if (renderClass === 'document') {
    throw new Error(`${row.filePath} is a document: it is restored through its editor`);
  }

  let bytes: Buffer | string;
  let file: FileVersionUpload | undefined;
  let view: Awaited<ReturnType<typeof buildArtifactVersionView>> = null;
  if (renderClass === 'file') {
    bytes = Buffer.from(version.content, 'base64');
    const mimeType = mimeTypeForArtifactFile(row.filePath);
    const viewHtml = await buildFileView({
      fileName: extractFileName(row.filePath),
      mimeType,
      bytes,
      runtimeDir: resolveArtifactRuntimeDir(),
    });
    file = { mimeType, viewHtml };
  } else {
    bytes = version.content;
    view = await buildArtifactVersionView(artifact, version.content);
  }

  // No await from here on.
  const latestVersion = latestVersionNumber(artifact.id);
  if (latestVersion !== args.baseVersion) return { status: 'conflict', latestVersion };
  writeFileSync(row.filePath, bytes);
  const saved = commitArtifactVersion({
    artifact,
    content: version.content,
    trigger: 'manual',
    label: `Restored v${version.versionNumber}`,
    authorName: args.authorName,
    baseVersion: args.baseVersion,
    view,
    file,
  });
  // A page tab shows its source; reporting the write keeps an open one current
  // even when no tab holds a watch on the file.
  if (saved.status === 'saved' && renderClass === 'page') {
    pushArtifactContentToRenderer(artifact.workItemId, artifact.id, row.filePath);
  }
  return saved;
}
