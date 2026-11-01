import { fileViewerForMimeType, type ArtifactFileMimeType } from '@shared/artifact-file-types';
import {
  escapeAttributeValue,
  hostHeadMarkup,
  inlineScriptTag,
  inlineStyleTag,
  readRuntimeFile,
  RUNTIME_VIEW_FILES,
} from '@main/core/artifact-pages/page-snapshot-markup';

/** A file view shares the page view cap (design 2026-09-24 §9 decision 5). */
const MAX_FILE_VIEW_BYTES = 8 * 1024 * 1024;

/** The view would be over the 8 MiB cap; the message names its size. */
export class FileViewTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `The file's shared view is ${(bytes / (1024 * 1024)).toFixed(1)} MiB, over the 8 MiB limit. Make the file smaller, then publish again.`
    );
    this.name = 'FileViewTooLargeError';
  }
}

const IMAGE_STYLE = [
  'html,body{margin:0;height:100%;background:var(--surface)}',
  'body{display:flex;align-items:center;justify-content:center}',
  'img{max-width:100%;max-height:100%;object-fit:contain}',
].join('');

const DOCX_STYLE = 'html,body{margin:0;background:var(--surface)}';

function viewDocument(runtimeDir: string, style: string, body: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    hostHeadMarkup(runtimeDir),
    inlineStyleTag(style),
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('');
}

/**
 * The self-contained view an image or docx version is shown through (design
 * 2026-09-24 §10 decision 4), the same document for the author, teammates and
 * a public link. An image is an `<img>` with a `data:` URL — an SVG stays an
 * image, so its scripts never run. A docx carries its bytes as inert base64
 * and the docx-preview bundle that renders them. A pdf or pptx has no view
 * (null): it is shown from its own bytes.
 */
export async function buildFileView(args: {
  fileName: string;
  mimeType: ArtifactFileMimeType;
  bytes: Buffer;
  runtimeDir: string;
}): Promise<string | null> {
  const { fileName, mimeType, bytes, runtimeDir } = args;
  if (fileViewerForMimeType(mimeType) !== 'view') return null;

  const base64 = bytes.toString('base64');
  const html = mimeType.startsWith('image/')
    ? viewDocument(
        runtimeDir,
        IMAGE_STYLE,
        `<img src="data:${mimeType};base64,${base64}" alt="${escapeAttributeValue(fileName)}">`
      )
    : viewDocument(
        runtimeDir,
        DOCX_STYLE,
        [
          '<div id="chord-docx"></div>',
          // Base64 has no `<`, so it cannot end its own element.
          `<script type="application/octet-stream" id="chord-file">${base64}</script>`,
          inlineScriptTag(readRuntimeFile(runtimeDir, RUNTIME_VIEW_FILES.docxViewer)),
        ].join('')
      );

  const viewBytes = Buffer.byteLength(html, 'utf-8');
  if (viewBytes > MAX_FILE_VIEW_BYTES) throw new FileViewTooLargeError(viewBytes);
  return html;
}
