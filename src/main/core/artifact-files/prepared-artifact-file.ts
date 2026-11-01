import { createHash } from 'node:crypto';
import {
  fileViewerForMimeType,
  type ArtifactFileMimeType,
  type ArtifactFileViewer,
} from '@shared/artifact-file-types';
import { artifactPageOrigin } from '@main/core/artifact-pages/page-response-headers';
import {
  registerFileBytesPageSource,
  registerSnapshotPageSource,
} from '@main/core/artifact-pages/page-source-registry';

/**
 * A binary artifact ready to show (design 2026-09-24 §10 "Desktop"): which
 * viewer, and the `chord-artifact://` origin that serves it — the view of an
 * image or docx, the bytes of a pdf, nothing for a pptx card.
 */
export interface PreparedArtifactFile {
  viewer: ArtifactFileViewer;
  url: string | null;
  fileName: string;
  mimeType: ArtifactFileMimeType;
  byteSize: number;
  /** The saved version shown; null for the file as it is on disk now. */
  versionId: string | null;
  versionNumber: number | null;
}

/**
 * Registers the origin for one version of a file. `versionKey` is the version
 * id, or null for bytes that are no version (the file on disk now), which are
 * then keyed by their digest. `view` is the file's view: the one uploaded with
 * the version, or one built here from the local bytes.
 */
export function registerPreparedFile(args: {
  artifactId: string;
  versionKey: string | null;
  fileName: string;
  mimeType: ArtifactFileMimeType;
  bytes: Buffer;
  view: string | null;
  versionId: string | null;
  versionNumber: number | null;
}): PreparedArtifactFile {
  const viewer = fileViewerForMimeType(args.mimeType);
  const versionKey =
    args.versionKey ?? `disk-${createHash('sha256').update(args.bytes).digest('hex')}`;
  let url: string | null = null;
  if (viewer === 'view') {
    if (args.view === null) throw new Error(`${args.fileName} has no view to show`);
    const source = registerSnapshotPageSource({
      artifactId: args.artifactId,
      versionId: versionKey,
      html: args.view,
    });
    url = `${artifactPageOrigin(source.pageId)}/`;
  } else if (viewer === 'pdf') {
    const source = registerFileBytesPageSource({
      artifactId: args.artifactId,
      versionKey,
      bytes: args.bytes,
      mimeType: args.mimeType,
    });
    url = `${artifactPageOrigin(source.pageId)}/`;
  }
  return {
    viewer,
    url,
    fileName: args.fileName,
    mimeType: args.mimeType,
    byteSize: args.bytes.byteLength,
    versionId: args.versionId,
    versionNumber: args.versionNumber,
  };
}
