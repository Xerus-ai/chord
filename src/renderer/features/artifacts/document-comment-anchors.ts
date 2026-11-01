import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface DocumentRange {
  from: number;
  to: number;
}

/**
 * The document's text as `textBetween(0, size, ' ')` reads it, with the
 * document position of every character. A block separator takes the position
 * of the block it opens; it is never the first or last character of a match
 * that is mapped back, since a quote starts and ends inside text.
 */
function readTextWithPositions(doc: ProseMirrorNode): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  let first = true;
  doc.descendants((node, pos) => {
    const nodeText = node.isText
      ? (node.text ?? '')
      : node.isLeaf && node.type.spec.leafText
        ? node.type.spec.leafText(node)
        : '';
    if (node.isBlock && ((node.isLeaf && nodeText) || node.isTextblock)) {
      if (first) first = false;
      else {
        text += ' ';
        positions.push(pos);
      }
    }
    for (let i = 0; i < nodeText.length; i++) positions.push(node.isText ? pos + i : pos);
    text += nodeText;
  });
  return { text, positions };
}

/**
 * Where a text-selection comment is now (shared-items step 1, S6). The
 * comment stores the position its selection started at and the text it
 * quoted; the position goes stale as soon as anything above it is edited, so
 * the quote is what is searched for, and the stored position only chooses
 * between repeats of it. Null when the quote is no longer in the document.
 */
export function locateCommentAnchor(
  doc: ProseMirrorNode,
  quote: string,
  storedPos: number
): DocumentRange | null {
  if (!quote) return null;
  const { text, positions } = readTextWithPositions(doc);
  let best: DocumentRange | null = null;
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    const range = { from: positions[at], to: positions[at + quote.length - 1] + 1 };
    if (!best || Math.abs(range.from - storedPos) < Math.abs(best.from - storedPos)) best = range;
  }
  return best;
}
