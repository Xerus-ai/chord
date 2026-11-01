import { describe, expect, it } from 'vitest';
import type { ChatEntry } from './chat-types';
import { findRevealIndex } from './transcript-reveal';
import type { TranscriptItem } from './transcript-rows';

function message(id: string): TranscriptItem {
  return { sort: 1, type: 'message', entry: { kind: 'message', id } as ChatEntry };
}

const ITEMS: TranscriptItem[] = [
  { sort: 0, type: 'divider', key: 'divider:s1', ordinal: 1, startedAt: 0 },
  message('m1'),
  {
    sort: 2,
    type: 'turn',
    turn: {
      id: 'm2',
      workItemId: 'w',
      agentName: 'A',
      items: [],
      status: 'complete',
      timestamp: 2,
    },
  },
  message('m3'),
];

/** The row a reveal scrolls to: the message row with that id (step 5, decision 3). */
describe('findRevealIndex', () => {
  it('finds the message row', () => {
    expect(findRevealIndex(ITEMS, 'm3')).toBe(3);
    expect(findRevealIndex(ITEMS, 'm1')).toBe(1);
  });

  it('is -1 while the row is not loaded, and for a turn of the same id', () => {
    expect(findRevealIndex(ITEMS, 'missing')).toBe(-1);
    expect(findRevealIndex(ITEMS, 'm2')).toBe(-1);
  });
});
