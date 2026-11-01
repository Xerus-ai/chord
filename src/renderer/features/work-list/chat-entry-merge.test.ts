import { describe, expect, it } from 'vitest';
import { compareChatEntries, mergeChatEntries } from './chat-entry-merge';
import type { ChatEntry } from './chat-types';

/** `createdAt` in seconds; `createdAtMs` defaults to the start of that second. */
function message(id: string, createdAt: number, createdAtMs = createdAt * 1000): ChatEntry {
  return {
    kind: 'message',
    id,
    sender: 'human',
    senderId: null,
    name: 'Me',
    initials: 'M',
    time: '10:00',
    createdAt,
    createdAtMs,
    blocks: [{ type: 'text', text: id }],
  };
}

function systemEvent(id: string, createdAt: number): ChatEntry {
  return {
    kind: 'system-event',
    id,
    commitHash: 'abc1234',
    message: 'committed',
    createdAt,
    createdAtMs: createdAt * 1000,
  };
}

describe('mergeChatEntries', () => {
  it('returns the base untouched when nothing is incoming', () => {
    const base = [message('a', 1)];
    expect(mergeChatEntries(base, [])).toBe(base);
  });

  it('appends entries the base does not have', () => {
    const merged = mergeChatEntries([message('a', 1)], [message('b', 2)]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps rows that arrived while the history SELECT was in flight', () => {
    // The seed is the base; the buffered live rows must survive it.
    const seed = [message('a', 1), message('b', 2)];
    const buffered = [message('c', 3)];
    expect(mergeChatEntries(seed, buffered).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops incoming duplicates of base entries', () => {
    const merged = mergeChatEntries([message('a', 1)], [message('a', 1), message('b', 2)]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('drops duplicates within the incoming batch', () => {
    const merged = mergeChatEntries([], [message('a', 1), message('a', 1)]);
    expect(merged.map((e) => e.id)).toEqual(['a']);
  });

  it('returns the base identity when every incoming entry is already known', () => {
    const base = [message('a', 1)];
    expect(mergeChatEntries(base, [message('a', 1)])).toBe(base);
  });
});

describe('compareChatEntries', () => {
  it('orders messages by creation time', () => {
    const sorted = [message('b', 2), message('a', 1)].sort(compareChatEntries);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('interleaves system events by their own timestamp', () => {
    // A commit event belongs where it happened, not at the top of the chat.
    const sorted = [message('later', 3), systemEvent('commit', 2), message('early', 1)].sort(
      compareChatEntries
    );
    expect(sorted.map((e) => e.id)).toEqual(['early', 'commit', 'later']);
  });

  it('orders two messages of the same second by their milliseconds (devstation-vihv)', () => {
    const sorted = [message('second', 5, 5_900), message('first', 5, 5_100)].sort(
      compareChatEntries
    );
    expect(sorted.map((e) => e.id)).toEqual(['first', 'second']);
  });
});
