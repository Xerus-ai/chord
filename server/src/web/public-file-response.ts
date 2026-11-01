import type { Response } from 'express';
import { fileTypeRule, isInlineFile } from '../artifact-file-types.js';
import type { ArtifactFile } from '../artifact-version-reads.js';
import { FRAME_CSP } from './html.js';

/**
 * The name a public file is served under: the artifact's name with the file's
 * extension, reduced to characters a Content-Disposition filename can carry
 * unquoted-safe.
 */
export function publicFileName(artifactName: string, mimeType: string): string {
  const extension = fileTypeRule(mimeType).extension;
  const base = artifactName.toLowerCase().endsWith(extension)
    ? artifactName.slice(0, -extension.length)
    : artifactName;
  const safe = base.replace(/[^\w .()-]/g, '_').trim() || 'file';
  return `${safe}${extension}`;
}

/**
 * A file artifact's bytes under the frame CSP (P6 §10). A pdf is inline — the
 * host page frames it WITHOUT the sandbox attribute, since Chromium blocks its
 * PDF viewer in a sandboxed frame; the response's own CSP sandbox still gives
 * it an opaque origin. Everything else is an attachment, never rendered here.
 */
export function sendPublicFile(res: Response, artifactName: string, file: ArtifactFile): void {
  const disposition = isInlineFile(file.mime_type) ? 'inline' : 'attachment';
  res
    .status(200)
    .set({
      'Content-Type': file.mime_type,
      'Content-Disposition': `${disposition}; filename="${publicFileName(artifactName, file.mime_type)}"`,
      'Content-Security-Policy': FRAME_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    })
    .send(Buffer.from(file.content_base64, 'base64'));
}
