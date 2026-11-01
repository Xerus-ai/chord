import { renderAsync } from 'docx-preview';
import { fitDocxPagesWhenLaidOut } from './docx-page-fit';

/**
 * Entry of `docx-viewer-standalone.js` (design 2026-09-24 §10): renders the
 * docx a file view carries. The view holds the file as base64 in an inert
 * `<script type="application/octet-stream" id="chord-file">` and an empty
 * `#chord-docx` container (main/core/artifact-files/build-file-view.ts); the
 * frame can fetch nothing, so images and fonts become `data:` URLs. Once
 * rendered, the pages are scaled to the frame's width and again whenever it
 * changes (docx-page-fit.ts). A document that does not render says so in the
 * frame and throws.
 */
const source = document.getElementById('chord-file');
const container = document.getElementById('chord-docx');
if (!source || !container) {
  throw new Error('This docx view is missing its file or its container');
}

const binary = atob((source.textContent ?? '').trim());
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

function fitToFrame(): void {
  const wrapper = container?.querySelector<HTMLElement>('.docx-wrapper');
  if (!wrapper) throw new Error('This docx view rendered no page wrapper');
  fitDocxPagesWhenLaidOut(wrapper, document.documentElement.clientWidth);
}

const rendered = renderAsync(bytes, container, undefined, {
  inWrapper: true,
  ignoreLastRenderedPageBreak: true,
  useBase64URL: true,
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  container.textContent = `This document could not be shown: ${message}`;
  throw error;
});

// Outside the render's catch: a fit problem is an error in the console, not
// a replaced document.
void rendered.then(() => {
  fitToFrame();
  window.addEventListener('resize', fitToFrame);
});
