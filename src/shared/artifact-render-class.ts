import type { ArtifactType } from './stream-items';

/**
 * How an artifact is put on screen. Users see five formats; the engine has
 * three render paths (plan 2026-09-23 §2.2, design 2026-09-24 §9–§10):
 *
 * - `document` — TipTap + Yjs co-editing (`.md`, `.txt`). The only class with
 *   a Yjs room.
 * - `page` — an opaque-origin sandboxed frame served over `chord-artifact://`
 *   (`.html` web pages, `.tsx` interactive prototypes, `.mdx` rich documents).
 *   Everyone but the author views the self-contained view uploaded with each
 *   version (§9).
 * - `file` — a binary file (`.pdf/.docx/.pptx`, images), versioned as its
 *   bytes and shown by MIME type (`artifact-file-types.ts`, §10).
 */
export type ArtifactRenderClass = 'document' | 'page' | 'file';

export function renderClassForArtifactType(type: ArtifactType): ArtifactRenderClass {
  switch (type) {
    case 'markdown':
    case 'text':
      return 'document';
    case 'web':
    case 'prototype':
    case 'mdx':
      return 'page';
    case 'document':
    case 'image':
      return 'file';
  }
}

const ARTIFACT_TYPE_BY_EXTENSION: Record<string, ArtifactType> = {
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.txt': 'text',
  '.pdf': 'document',
  '.docx': 'document',
  '.pptx': 'document',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.svg': 'image',
  '.html': 'web',
  '.tsx': 'prototype',
  '.jsx': 'prototype',
};

/** The artifact format a file would be, by extension; null for any other file. */
export function artifactTypeForPath(filePath: string): ArtifactType | null {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return ARTIFACT_TYPE_BY_EXTENSION[name.slice(dot).toLowerCase()] ?? null;
}
