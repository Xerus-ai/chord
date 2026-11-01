import { describe, expect, it } from 'vitest';
import {
  documentAnchorsFor,
  filterThreads,
  numberThreads,
  pagePinsFor,
  threadForComment,
  threadForNumber,
} from './comment-numbering';
import type { CommentAnchorStatus } from './page/comment-anchor-status';
import type { CommentThread } from './use-comments';

function thread(
  id: string,
  createdAt: string,
  options: {
    resolved?: boolean;
    anchorKey?: string | null;
    anchorText?: string | null;
    anchorStatus?: CommentAnchorStatus;
  } = {}
): CommentThread {
  return {
    root: {
      id,
      body: `body of ${id}`,
      author_name: 'Maya',
      anchor_key: options.anchorKey ?? null,
      anchor_text: options.anchorText ?? null,
      anchorStatus: options.anchorStatus ?? { kind: 'unverified' },
      resolved: options.resolved ?? false,
      created_at: createdAt,
    },
    replies: [],
  };
}

// useComments hands threads over newest first; numbers must not follow that order.
const NEWEST_FIRST = [
  thread('c', '2026-09-26T12:00:03.000Z'),
  thread('b', '2026-09-26T12:00:02.000Z', { resolved: true }),
  thread('a', '2026-09-26T12:00:01.000Z'),
];

describe('numberThreads', () => {
  it('numbers threads by creation order, oldest first, and lists them in that order', () => {
    expect(numberThreads(NEWEST_FIRST).map(({ n, thread }) => [n, thread.root.id])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('keeps every number when a thread is resolved', () => {
    const resolvedA = NEWEST_FIRST.map((t) =>
      t.root.id === 'a' ? { ...t, root: { ...t.root, resolved: true } } : t
    );
    expect(numberThreads(resolvedA).map(({ n, thread }) => [n, thread.root.id])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('breaks a creation-time tie by id, so the numbers are the same on every client', () => {
    const tied = [thread('y', '2026-09-26T12:00:00.000Z'), thread('x', '2026-09-26T12:00:00.000Z')];
    expect(numberThreads(tied).map(({ thread }) => thread.root.id)).toEqual(['x', 'y']);
    expect(numberThreads([...tied].reverse()).map(({ thread }) => thread.root.id)).toEqual([
      'x',
      'y',
    ]);
  });
});

describe('filterThreads', () => {
  const numbered = numberThreads(NEWEST_FIRST);

  it('Open shows unresolved threads with their own numbers', () => {
    expect(filterThreads(numbered, 'open').map(({ n }) => n)).toEqual([1, 3]);
  });

  it('Resolved shows resolved threads with their own numbers', () => {
    expect(filterThreads(numbered, 'resolved').map(({ n }) => n)).toEqual([2]);
  });
});

describe('pagePinsFor', () => {
  it('pins each thread anchored to a stamped element, under the thread number', () => {
    const numbered = numberThreads([
      thread('a', '2026-09-26T12:00:01.000Z', { anchorKey: 'chord-id:h1', anchorText: '<h1> Hi' }),
      thread('b', '2026-09-26T12:00:02.000Z'),
      thread('c', '2026-09-26T12:00:03.000Z', { anchorKey: 'chord-id:cta' }),
    ]);
    expect(pagePinsFor(numbered)).toEqual([
      { n: 1, chordId: 'h1' },
      { n: 3, chordId: 'cta' },
    ]);
  });

  it('pins an element that changed, but not one that is gone from the source', () => {
    const numbered = numberThreads([
      thread('a', '2026-09-26T12:00:01.000Z', {
        anchorKey: 'chord-id:h1',
        anchorStatus: { kind: 'changed', current: '<h1> Other' },
      }),
      thread('b', '2026-09-26T12:00:02.000Z', {
        anchorKey: 'chord-id:gone',
        anchorStatus: { kind: 'missing' },
      }),
    ]);
    expect(pagePinsFor(numbered)).toEqual([{ n: 1, chordId: 'h1' }]);
  });

  it('never pins an anchor key that is not a valid stamped id', () => {
    const numbered = numberThreads([
      thread('a', '2026-09-26T12:00:01.000Z', { anchorKey: 'chord-id:NOT VALID' }),
      thread('b', '2026-09-26T12:00:02.000Z', { anchorKey: '42', anchorText: 'text' }),
    ]);
    expect(pagePinsFor(numbered)).toEqual([]);
  });
});

describe('documentAnchorsFor', () => {
  it('anchors each text-selection thread at its quoted text and stored position', () => {
    const numbered = numberThreads([
      thread('a', '2026-09-26T12:00:01.000Z', { anchorKey: '17', anchorText: 'the price' }),
      thread('b', '2026-09-26T12:00:02.000Z'),
      thread('c', '2026-09-26T12:00:03.000Z', { anchorKey: 'chord-id:h1', anchorText: '<h1>' }),
      thread('d', '2026-09-26T12:00:04.000Z', { anchorKey: '3', anchorText: '' }),
    ]);
    expect(documentAnchorsFor(numbered)).toEqual([{ n: 1, text: 'the price', pos: 17 }]);
  });
});

describe('threadForNumber', () => {
  const numbered = numberThreads(NEWEST_FIRST);

  it('finds the thread a pin number names', () => {
    expect(threadForNumber(numbered, 2)?.thread.root.id).toBe('b');
  });

  it('is null for a number no thread has (a page posting its own pin message)', () => {
    expect(threadForNumber(numbered, 99)).toBeNull();
  });
});

/** A notification names a comment; the card selects the thread that holds it. */
describe('threadForComment', () => {
  const withReply: CommentThread = {
    ...thread('b', '2026-09-26T12:00:02.000Z', { resolved: true }),
    replies: [
      {
        id: 'b-reply',
        body: 'reply',
        author_name: 'Raghav',
        created_at: '2026-09-26T13:00:00.000Z',
      },
    ],
  };
  const numbered = numberThreads([thread('c', '2026-09-26T12:00:03.000Z'), withReply]);

  it('finds the thread a root comment starts', () => {
    expect(threadForComment(numbered, 'c')).toMatchObject({ n: 2, thread: { root: { id: 'c' } } });
  });

  it('finds the thread a reply belongs to', () => {
    expect(threadForComment(numbered, 'b-reply')).toMatchObject({
      n: 1,
      thread: { root: { id: 'b', resolved: true } },
    });
  });

  it('is null for a comment no thread holds (deleted, or not loaded yet)', () => {
    expect(threadForComment(numbered, 'gone')).toBeNull();
  });
});
