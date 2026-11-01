import { isChordId } from '@shared/artifact-frame-constants';
import type { PagePin } from '@shared/artifact-frame-messages';
import { CHORD_ID_ANCHOR_PREFIX } from './page/picked-element';
import type { CommentThread } from './use-comments';

/**
 * Comment numbers (shared-items step 1, S6): the number on a thread in the
 * comments card is the number on its pin in a page and its badge in a
 * document. Numbers follow creation order, oldest first, with the id as the
 * tiebreak, so every client numbers the same threads the same way and a
 * resolved thread keeps its number.
 */
export interface NumberedThread {
  n: number;
  thread: CommentThread;
}

export type CommentFilter = 'open' | 'resolved';

/** A text-selection comment in a document: its quoted text and where it was made. */
export interface DocumentCommentAnchor {
  n: number;
  text: string;
  pos: number;
}

export function numberThreads(threads: CommentThread[]): NumberedThread[] {
  return [...threads]
    .sort((a, b) => {
      const byTime = Date.parse(a.root.created_at) - Date.parse(b.root.created_at);
      if (byTime !== 0) return byTime;
      return a.root.id < b.root.id ? -1 : a.root.id > b.root.id ? 1 : 0;
    })
    .map((thread, index) => ({ n: index + 1, thread }));
}

export function filterThreads(numbered: NumberedThread[], filter: CommentFilter): NumberedThread[] {
  const resolved = filter === 'resolved';
  return numbered.filter(({ thread }) => thread.root.resolved === resolved);
}

/**
 * The pins a page draws: one per thread on a stamped element. An element that
 * changed still has a pin (its id still resolves); one gone from the source
 * has nowhere to put it.
 */
export function pagePinsFor(numbered: NumberedThread[]): PagePin[] {
  const pins: PagePin[] = [];
  for (const { n, thread } of numbered) {
    const key = thread.root.anchor_key;
    if (!key?.startsWith(CHORD_ID_ANCHOR_PREFIX)) continue;
    if (thread.root.anchorStatus.kind === 'missing') continue;
    const chordId = key.slice(CHORD_ID_ANCHOR_PREFIX.length);
    if (isChordId(chordId)) pins.push({ n, chordId });
  }
  return pins;
}

const DOCUMENT_POSITION = /^\d+$/;

/**
 * The anchors a document draws: a text-selection comment stores the position
 * the selection started at and the text it quoted (FloatingComposer).
 */
export function documentAnchorsFor(numbered: NumberedThread[]): DocumentCommentAnchor[] {
  const anchors: DocumentCommentAnchor[] = [];
  for (const { n, thread } of numbered) {
    const { anchor_key: key, anchor_text: text } = thread.root;
    if (!key || !DOCUMENT_POSITION.test(key) || !text) continue;
    anchors.push({ n, text, pos: Number(key) });
  }
  return anchors;
}

/** The thread a pin or badge number names; null when none has it. */
export function threadForNumber(numbered: NumberedThread[], n: number): NumberedThread | null {
  return numbered.find((entry) => entry.n === n) ?? null;
}

/** The thread holding a comment, as its root or a reply; null when none holds it. */
export function threadForComment(
  numbered: NumberedThread[],
  commentId: string
): NumberedThread | null {
  return (
    numbered.find(
      ({ thread }) =>
        thread.root.id === commentId || thread.replies.some((reply) => reply.id === commentId)
    ) ?? null
  );
}
