import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { locateCommentAnchor } from './document-comment-anchors';

/**
 * A real ProseMirror schema with the shapes that matter here: text blocks,
 * inline marks splitting a text run, and a leaf with `leafText`.
 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    hard_break: { group: 'inline', inline: true, leafText: () => '\n' },
  },
  marks: { strong: {} },
});

function doc(...blocks: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node('doc', null, blocks);
}
function p(...content: (string | ProseMirrorNode)[]): ProseMirrorNode {
  return schema.node(
    'paragraph',
    null,
    content.map((c) => (typeof c === 'string' ? schema.text(c) : c))
  );
}
function strong(text: string): ProseMirrorNode {
  return schema.text(text, [schema.mark('strong')]);
}

/** Where the floating composer would have stored this selection (FloatingComposer). */
function selectionOf(root: ProseMirrorNode, text: string, occurrence = 0) {
  let found = -1;
  let seen = 0;
  root.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return;
    let at = node.text!.indexOf(text);
    while (at >= 0) {
      if (seen === occurrence) {
        found = pos + at;
        return;
      }
      seen += 1;
      at = node.text!.indexOf(text, at + 1);
    }
  });
  if (found < 0) throw new Error(`"${text}" is not in the document`);
  return { from: found, to: found + text.length };
}

describe('locateCommentAnchor', () => {
  it('finds the quoted text where the comment was made', () => {
    const d = doc(p('Team costs $24 a seat.'));
    const at = selectionOf(d, '$24');
    expect(locateCommentAnchor(d, '$24', at.from)).toEqual(at);
    expect(d.textBetween(at.from, at.to, ' ')).toBe('$24');
  });

  it('follows the text when edits above it moved it', () => {
    const before = doc(p('Team costs $24 a seat.'));
    const stored = selectionOf(before, '$24').from;
    const after = doc(p('A new first paragraph.'), p('Team costs $24 a seat.'));
    expect(locateCommentAnchor(after, '$24', stored)).toEqual(selectionOf(after, '$24'));
  });

  it('picks the occurrence nearest the stored position when the text repeats', () => {
    const d = doc(p('Team is $24.'), p('Pro is $24 too.'));
    const second = selectionOf(d, '$24', 1);
    expect(locateCommentAnchor(d, '$24', second.from)).toEqual(second);
    const first = selectionOf(d, '$24', 0);
    expect(locateCommentAnchor(d, '$24', first.from)).toEqual(first);
  });

  it('matches across marks inside one text block', () => {
    const d = doc(p('The ', strong('Team'), ' tier'));
    const from = selectionOf(d, 'The ').from;
    const range = locateCommentAnchor(d, 'The Team tier', from);
    expect(range).not.toBeNull();
    expect(d.textBetween(range!.from, range!.to, ' ')).toBe('The Team tier');
  });

  it('matches a selection that spanned blocks, as the composer quoted it', () => {
    const d = doc(p('First block'), p('second block'));
    const quoted = d.textBetween(selectionOf(d, 'block').from, selectionOf(d, 'second').to, ' ');
    expect(quoted).toBe('block second');
    const range = locateCommentAnchor(d, quoted, selectionOf(d, 'block').from);
    expect(range).toEqual({ from: selectionOf(d, 'block').from, to: selectionOf(d, 'second').to });
  });

  it('is null when the quoted text is no longer in the document', () => {
    const d = doc(p('Team costs $22 a seat.'));
    expect(locateCommentAnchor(d, '$24', 12)).toBeNull();
  });

  it('is null for empty quoted text', () => {
    expect(locateCommentAnchor(doc(p('Anything')), '', 1)).toBeNull();
  });
});
