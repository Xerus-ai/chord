import { mimeTypeForArtifactFile } from '@shared/artifact-file-types';
import { artifactTypeForPath, renderClassForArtifactType } from '@shared/artifact-render-class';
import { extractFileName } from '@main/core/artifacts/artifact-utils';
import { confineToCheckout } from '@main/core/work-items/repo-file-path';
import type { LoadedArtifactFile } from './prepare-local-artifact-file';
import { readArtifactFileBytes } from './read-artifact-file-bytes';

/**
 * A repo file that is no artifact but a binary format — pdf, docx, pptx, an
 * image — read from the checkout for the path tab's Preview (design
 * 2026-09-26 §3). It is the file on disk, so "Open" opens the file itself.
 */
export function loadRepoFileAt(checkoutPath: string, filePath: string): LoadedArtifactFile {
  const absolute = confineToCheckout(checkoutPath, filePath);
  if (absolute === null) throw new Error(`${filePath} is outside the work item's checkout`);
  const type = artifactTypeForPath(filePath);
  if (type === null || renderClassForArtifactType(type) !== 'file') {
    throw new Error(`${filePath} is not a binary file`);
  }
  const { bytes } = readArtifactFileBytes(absolute);
  return {
    fileName: extractFileName(filePath),
    mimeType: mimeTypeForArtifactFile(filePath),
    bytes,
    versionId: null,
    versionNumber: null,
    diskPath: absolute,
  };
}
