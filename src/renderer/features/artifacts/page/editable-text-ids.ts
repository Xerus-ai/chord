import { CHORD_ID_ATTRIBUTE, isChordId } from '@shared/artifact-frame-constants';

/**
 * The stamped elements a page may edit in place (S6): main's rule
 * (page-source-elements.ts `isTextElement` — every child is text, with some
 * copy in it) applied to the page's source. It is read from the source, not
 * the live page: every pickable element is stamped, and one a script fills
 * in reads as text in the page while the source has none, so main would
 * refuse its edit. Scripts never run in a parsed document.
 */
export function editableTextIdsOf(source: string): string[] {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const ids: string[] = [];
  for (const element of parsed.querySelectorAll(`[${CHORD_ID_ATTRIBUTE}]`)) {
    const id = element.getAttribute(CHORD_ID_ATTRIBUTE);
    if (!isChordId(id)) continue;
    const nodes = [...element.childNodes];
    if (nodes.length === 0 || !nodes.every((node) => node.nodeType === Node.TEXT_NODE)) continue;
    if (nodes.some((node) => (node.textContent ?? '').trim() !== '')) ids.push(id);
  }
  return ids;
}
