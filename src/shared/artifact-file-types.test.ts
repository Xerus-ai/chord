import { describe, expect, it } from 'vitest';
import {
  fileViewerForMimeType,
  MAX_ARTIFACT_FILE_BYTES,
  mimeTypeForArtifactFile,
} from './artifact-file-types';

/**
 * Binary artifacts (design 2026-09-24 §10 decision 4): the MIME type decides the
 * viewer, the same way for the author, a teammate and a public link.
 */
describe('artifact file types', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  it.each([
    ['C:/repo/Brief.PDF', 'application/pdf'],
    ['/repo/memo.docx', DOCX],
    ['/repo/deck.pptx', PPTX],
    ['/repo/chart.png', 'image/png'],
    ['/repo/photo.jpg', 'image/jpeg'],
    ['/repo/photo.jpeg', 'image/jpeg'],
    ['/repo/logo.svg', 'image/svg+xml'],
  ])('%s is %s', (path, mime) => {
    expect(mimeTypeForArtifactFile(path)).toBe(mime);
  });

  it('refuses a file that is not a binary artifact type', () => {
    expect(() => mimeTypeForArtifactFile('/repo/notes.md')).toThrow(/\.md/);
  });

  it.each([
    ['image/png', 'view'],
    ['image/jpeg', 'view'],
    ['image/svg+xml', 'view'],
    [DOCX, 'view'],
    ['application/pdf', 'pdf'],
    [PPTX, 'card'],
  ] as const)('%s is shown as %s', (mime, viewer) => {
    expect(fileViewerForMimeType(mime)).toBe(viewer);
  });

  it('refuses an unknown MIME type rather than guessing a viewer', () => {
    expect(() => fileViewerForMimeType('text/html')).toThrow(/text\/html/);
  });

  it('caps a file at 8 MiB', () => {
    expect(MAX_ARTIFACT_FILE_BYTES).toBe(8 * 1024 * 1024);
  });
});
