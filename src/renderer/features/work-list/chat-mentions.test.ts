import { describe, expect, it } from 'vitest';
import { activeMentionAt } from './chat-mentions';
import type { MentionKind } from './mention-menu';

/** Caret at the end of what has been typed, which is the composer's own case. */
function atEnd(value: string) {
  return activeMentionAt(value, value.length);
}

describe('activeMentionAt', () => {
  it('opens people and work-item menus on the bare trigger', () => {
    expect(atEnd('@')).toEqual({ kind: 'people', query: '', start: 0 });
    expect(atEnd('#')).toEqual({ kind: 'work-items', query: '', start: 0 });
  });

  it('does NOT open the file menu on a bare +', () => {
    // "1 + 1": the + is arithmetic. Opening the menu here let it swallow the
    // Enter that was meant to send the message.
    expect(atEnd('1 +')).toBeNull();
    expect(atEnd('+')).toBeNull();
  });

  it('opens the file menu once something is typed after the +', () => {
    expect(atEnd('+src')).toEqual({ kind: 'files', query: 'src', start: 0 });
    expect(atEnd('look at +chat')).toEqual({ kind: 'files', query: 'chat', start: 8 });
  });

  it('reports the trigger index, not the caret', () => {
    const mention = atEnd('hey @ali');
    expect(mention).toEqual({ kind: 'people', query: 'ali', start: 4 });
    expect('hey @ali'[mention!.start]).toBe('@');
  });

  it('ignores a trigger that is not at a word boundary', () => {
    expect(atEnd('a@b')).toBeNull();
    expect(atEnd('user@example.com')).toBeNull();
  });

  it('closes once a non-people token ends in whitespace', () => {
    expect(atEnd('+src/main ')).toBeNull();
    expect(atEnd('#my-item ')).toBeNull();
  });

  it('keeps filtering people through a second word — display names have two', () => {
    expect(atEnd('@Ana ')).toEqual({ kind: 'people', query: 'Ana ', start: 0 });
    expect(atEnd('@Ana Lov')).toEqual({ kind: 'people', query: 'Ana Lov', start: 0 });
    expect(atEnd('hey @Ana Lov')).toEqual({ kind: 'people', query: 'Ana Lov', start: 4 });
  });

  it('gives up at a third word, where the text is prose and not a name', () => {
    expect(atEnd('@Ana Lovelace can')).toBeNull();
  });

  it('reads the token containing the caret, not the end of the value', () => {
    const value = '@ali and more text';
    expect(activeMentionAt(value, 4)).toEqual({ kind: 'people', query: 'ali', start: 0 });
  });

  it('is null when the caret sits before any trigger', () => {
    expect(activeMentionAt('@alice', 0)).toBeNull();
  });
});

describe('activeMentionAt, limited kinds', () => {
  const withoutFiles: ReadonlySet<MentionKind> = new Set(['people', 'work-items']);

  it('ignores a trigger whose kind the composer does not offer', () => {
    // A teammate has no checkout: `+src` must not ask this machine for files.
    expect(activeMentionAt('+src', 4, withoutFiles)).toBeNull();
  });

  it('still opens the kinds it offers', () => {
    expect(activeMentionAt('@', 1, withoutFiles)).toEqual({ kind: 'people', query: '', start: 0 });
  });
});
