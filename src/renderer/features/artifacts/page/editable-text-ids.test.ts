// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CHORD_ID_ATTRIBUTE } from '@shared/artifact-frame-constants';
import { editableTextIdsOf } from './editable-text-ids';

const stamp = (id: string) => `${CHORD_ID_ATTRIBUTE}="${id}"`;

/**
 * Which stamped elements a page may edit in place: the same rule main applies
 * on commit (page-source-elements.ts `isTextElement`), read from the source —
 * never from the live page, where a script may have filled an element in.
 */
describe('editableTextIdsOf', () => {
  it('lists stamped elements whose source children are all text with some copy', () => {
    const source = `<!doctype html><html><head><title ${stamp('t')}>Title</title></head><body>
      <h1 ${stamp('h')}>Heading</h1>
      <p ${stamp('m')}>Mixed <b ${stamp('b')}>bold</b> text</p>
      <div ${stamp('gen')}></div>
      <span ${stamp('ws')}>   </span>
      <p>Unstamped copy</p>
      <button ${stamp('cta')}>Start <!-- note --></button>
    </body></html>`;
    expect(editableTextIdsOf(source)).toEqual(['t', 'h', 'b']);
  });

  it('ignores a stamp that is not a valid id', () => {
    expect(editableTextIdsOf(`<p ${stamp('NOT VALID')}>Copy</p>`)).toEqual([]);
  });

  it('is empty for a source with no stamped text', () => {
    expect(editableTextIdsOf('<main><div></div></main>')).toEqual([]);
  });
});
