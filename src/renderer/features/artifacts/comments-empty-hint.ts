import type { PageMode } from '@shared/artifact-frame-constants';
import type { ArtifactRenderClass } from '@shared/artifact-render-class';

/**
 * What the comments card's empty state tells someone to do: click the page
 * where it picks (the owner's and, since shared-items step 4, a teammate's),
 * select text in a document, otherwise write in the box below. `null` is an
 * artifact whose content has not loaded yet.
 */
export function commentsEmptyHint({
  renderClass,
  pageModes,
}: {
  renderClass: ArtifactRenderClass | null;
  pageModes: readonly PageMode[];
}): string {
  if (renderClass === 'page' && pageModes.includes('pick')) {
    return 'Click anywhere on the page to add one.';
  }
  if (renderClass === 'document') return 'Select text in the document to add one.';
  return 'Write one below.';
}
