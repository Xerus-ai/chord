import type { CloudChatMessage } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import { selectThreadMessages } from './participant-threads';

function message(overrides: Partial<CloudChatMessage> = {}): CloudChatMessage {
  return {
    id: 'm-1',
    work_item_id: 'wi-1',
    session_id: null,
    sender_id: 'u-1',
    sender_type: 'human',
    sender_name: 'someone',
    content: 'hi',
    message_type: 'text',
    metadata: {},
    created_at: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
}

describe('selectThreadMessages', () => {
  it('returns the thread own rows', () => {
    const mine = message({ id: 'mine', session_id: 'sess-1' });
    const theirs = message({ id: 'theirs', session_id: 'sess-2' });
    const selected = selectThreadMessages([mine, theirs], 'sess-1');
    expect(selected.map((m) => m.id)).toEqual(['mine']);
  });

  it('includes null-session rows in EVERY thread as work-item history', () => {
    // Pre-registry rows: old Room messages and participant sends the server
    // stamped null. They belong to no thread, and session tabs are dropped
    // when sessions end, so adopting them into one would strand them.
    const history = message({ id: 'history', session_id: null });
    const mine = message({ id: 'mine', session_id: 'sess-1' });
    const theirs = message({ id: 'theirs', session_id: 'sess-2' });

    expect(selectThreadMessages([history, mine, theirs], 'sess-1').map((m) => m.id)).toEqual([
      'history',
      'mine',
    ]);
    expect(selectThreadMessages([history, mine, theirs], 'sess-2').map((m) => m.id)).toEqual([
      'history',
      'theirs',
    ]);
  });

  it('preserves the incoming order rather than re-sorting', () => {
    // The store hands rows over already sorted (cloud-chat-store); a second
    // sort here would be a second source of truth for ordering.
    const rows = [
      message({ id: 'a', session_id: 'sess-1' }),
      message({ id: 'b', session_id: null }),
      message({ id: 'c', session_id: 'sess-1' }),
    ];
    expect(selectThreadMessages(rows, 'sess-1').map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('gives the item chat (no session tab) every row', () => {
    // An item whose owner has started no chat shows its whole history.
    const rows = [
      message({ id: 'a', session_id: 'sess-1' }),
      message({ id: 'b', session_id: null }),
      message({ id: 'c', session_id: 'sess-2' }),
    ];
    expect(selectThreadMessages(rows, null).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});
