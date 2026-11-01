/**
 * Binary artifacts (render class `file`, P6 §10): the MIME types a file
 * version may carry, which content type each belongs to, and whether it is
 * shown through an uploaded view. Mirrors the desktop's
 * src/shared/artifact-file-types.ts (the server package does not import from
 * the app tree).
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface FileTypeRule {
  /** The artifact content type a file of this MIME type is registered as. */
  contentType: 'document' | 'image';
  /** Shown through a view (image, docx) rather than its own bytes (pdf, pptx). */
  hasView: boolean;
  extension: string;
}

const FILE_TYPE_RULES: Record<string, FileTypeRule> = {
  'application/pdf': { contentType: 'document', hasView: false, extension: '.pdf' },
  [DOCX]: { contentType: 'document', hasView: true, extension: '.docx' },
  [PPTX]: { contentType: 'document', hasView: false, extension: '.pptx' },
  'image/png': { contentType: 'image', hasView: true, extension: '.png' },
  'image/jpeg': { contentType: 'image', hasView: true, extension: '.jpg' },
  'image/svg+xml': { contentType: 'image', hasView: true, extension: '.svg' },
};

export const ARTIFACT_FILE_MIME_TYPES = Object.keys(FILE_TYPE_RULES) as [string, ...string[]];

/** §10 decision 3: a file version is at most 8 MiB of raw bytes. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function fileTypeRule(mimeType: string): FileTypeRule {
  const rule = Object.hasOwn(FILE_TYPE_RULES, mimeType) ? FILE_TYPE_RULES[mimeType] : undefined;
  if (!rule) throw new Error(`Unknown artifact file MIME type: ${mimeType}`);
  return rule;
}

/** Shown inline by the browser (a pdf in its viewer) or offered as a download. */
export function isInlineFile(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}
