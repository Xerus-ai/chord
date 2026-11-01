import { describe, expect, it } from 'vitest';
import { commentsEmptyHint } from './comments-empty-hint';

describe('commentsEmptyHint', () => {
  it('a page that picks says to click on it, owner and teammate alike', () => {
    expect(
      commentsEmptyHint({ renderClass: 'page', pageModes: ['view', 'edit-text', 'pick'] })
    ).toBe('Click anywhere on the page to add one.');
    expect(commentsEmptyHint({ renderClass: 'page', pageModes: ['view', 'pick'] })).toBe(
      'Click anywhere on the page to add one.'
    );
  });

  it('a document says to select text', () => {
    expect(commentsEmptyHint({ renderClass: 'document', pageModes: [] })).toBe(
      'Select text in the document to add one.'
    );
  });

  it('anything that cannot anchor a comment points at the box below', () => {
    expect(commentsEmptyHint({ renderClass: 'file', pageModes: [] })).toBe('Write one below.');
    expect(commentsEmptyHint({ renderClass: 'page', pageModes: ['view'] })).toBe(
      'Write one below.'
    );
  });
});
