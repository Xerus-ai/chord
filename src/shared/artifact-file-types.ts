/**
 * Binary artifacts — `.pdf/.docx/.pptx` and images, render class `file`
 * (design 2026-09-24 §10). A file version is the file's bytes and MIME type;
 * the MIME type alone decides how it is shown, the same way for the author, a
 * teammate and a public link. The server's `artifact-file-types.ts` mirrors
 * this table.
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const ARTIFACT_FILE_MIME_TYPES = [
  'application/pdf',
  DOCX,
  PPTX,
  'image/png',
  'image/jpeg',
  'image/svg+xml',
] as const;

export type ArtifactFileMimeType = (typeof ARTIFACT_FILE_MIME_TYPES)[number];

/**
 * - `view` — a self-contained HTML view (image as a `data:` URL, docx through
 *   docx-preview) in the page sandbox.
 * - `pdf` — the bytes as their own response, in a frame without the `sandbox`
 *   attribute: Chromium's PDF viewer is blocked inside one (measured §10).
 * - `card` — name, size, Open / Save a copy; no in-app renderer is mature enough.
 */
export type ArtifactFileViewer = 'view' | 'pdf' | 'card';

const MIME_TYPE_BY_EXTENSION: Record<string, ArtifactFileMimeType> = {
  '.pdf': 'application/pdf',
  '.docx': DOCX,
  '.pptx': PPTX,
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const VIEWER_BY_MIME_TYPE: Record<ArtifactFileMimeType, ArtifactFileViewer> = {
  'application/pdf': 'pdf',
  [DOCX]: 'view',
  [PPTX]: 'card',
  'image/png': 'view',
  'image/jpeg': 'view',
  'image/svg+xml': 'view',
};

/** The file extension each MIME type is saved under ("Save a copy", downloads). */
export const EXTENSION_BY_MIME_TYPE: Record<ArtifactFileMimeType, string> = {
  'application/pdf': '.pdf',
  [DOCX]: '.docx',
  [PPTX]: '.pptx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
};

/** §10 decision 3: a file version is at most 8 MiB of raw bytes. */
export const MAX_ARTIFACT_FILE_BYTES = 8 * 1024 * 1024;

export function isArtifactFileMimeType(value: string): value is ArtifactFileMimeType {
  return (ARTIFACT_FILE_MIME_TYPES as readonly string[]).includes(value);
}

export function mimeTypeForArtifactFile(filePath: string): ArtifactFileMimeType {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const mimeType = MIME_TYPE_BY_EXTENSION[ext];
  if (!mimeType) throw new Error(`A ${ext} file is not a binary artifact`);
  return mimeType;
}

export function fileViewerForMimeType(mimeType: string): ArtifactFileViewer {
  if (!isArtifactFileMimeType(mimeType)) {
    throw new Error(`No viewer for artifact files of type ${mimeType}`);
  }
  return VIEWER_BY_MIME_TYPE[mimeType];
}

export function describeFileSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}
