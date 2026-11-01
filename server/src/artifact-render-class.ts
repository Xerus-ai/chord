/**
 * How an artifact is put on screen, derived from its content type. Mirrors
 * the desktop's src/shared/artifact-render-class.ts (the server package does
 * not import from the app tree); the two tables must agree, and the route
 * test pins every content type the client can send.
 *
 * - `document` — TipTap + Yjs co-editing; the only class with a Hocuspocus room.
 * - `page` — an opaque-origin sandboxed frame; NEVER gets a Yjs room. Web
 *   pages, prototypes and mdx (P6 §9 decision 2: viewed through its view).
 * - `file` — a binary file (pdf, docx, pptx, images; P6 §10): versioned as its
 *   bytes and MIME type (artifact-file-types.ts), NEVER gets a Yjs room.
 */
export type ArtifactRenderClass = 'document' | 'page' | 'file';

const RENDER_CLASS_BY_CONTENT_TYPE: Record<string, ArtifactRenderClass> = {
  markdown: 'document',
  mdx: 'page',
  text: 'document',
  document: 'file',
  web: 'page',
  prototype: 'page',
  image: 'file',
};

export function isKnownContentType(contentType: string): boolean {
  return Object.hasOwn(RENDER_CLASS_BY_CONTENT_TYPE, contentType);
}

export function renderClassForContentType(contentType: string): ArtifactRenderClass {
  const renderClass = isKnownContentType(contentType)
    ? RENDER_CLASS_BY_CONTENT_TYPE[contentType]
    : undefined;
  if (!renderClass) throw new Error(`Unknown artifact content type: ${contentType}`);
  return renderClass;
}
