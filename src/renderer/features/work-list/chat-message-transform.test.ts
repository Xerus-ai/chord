import { describe, expect, it } from 'vitest';
import { dbRowToChatEntry, sessionCloudEntries } from './chat-message-transform';

type Row = Parameters<typeof dbRowToChatEntry>[0];

function row(overrides: Partial<Row>): Row {
  return {
    id: 'row-1',
    workItemId: 'wi-1',
    senderType: 'human',
    senderId: 'user-1',
    senderName: 'Ada',
    content: 'hello',
    messageType: 'text',
    metadata: '{}',
    createdAt: 1_700_000_000,
    createdAtMs: 1_700_000_000_123,
    ...overrides,
  };
}

describe('dbRowToChatEntry metadata guard', () => {
  it('renders a visible degraded row instead of throwing on unparseable metadata', () => {
    const entry = dbRowToChatEntry(row({ messageType: 'tool_call', metadata: '{not json' }));

    expect(entry.kind).toBe('system-event');
    if (entry.kind !== 'system-event') throw new Error('expected a system-event entry');
    expect(entry.degraded).toBe(true);
    expect(entry.message).not.toBe('');
    expect(entry.id).toBe('row-1');
    expect(entry.createdAt).toBe(1_700_000_000);
  });

  it('degrades a commit row whose metadata is corrupt', () => {
    const entry = dbRowToChatEntry(
      row({ messageType: 'commit', metadata: '{"commitHash":', content: 'wip' })
    );

    expect(entry.kind).toBe('system-event');
    if (entry.kind !== 'system-event') throw new Error('expected a system-event entry');
    expect(entry.degraded).toBe(true);
  });

  it('degrades metadata that parses to a non-object', () => {
    const entry = dbRowToChatEntry(row({ messageType: 'plan', metadata: '"just a string"' }));

    expect(entry.kind).toBe('system-event');
    if (entry.kind !== 'system-event') throw new Error('expected a system-event entry');
    expect(entry.degraded).toBe(true);
  });

  it('contains the damage to the single bad row', () => {
    // One corrupt row used to throw out of the map() that builds the whole
    // history, blanking every message in the chat.
    const rows = [
      row({ id: 'a', content: 'first' }),
      row({ id: 'b', messageType: 'tool_call', metadata: '}{' }),
      row({ id: 'c', content: 'third' }),
    ];

    const entries = rows.map(dbRowToChatEntry);

    expect(entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(entries[0].kind).toBe('message');
    expect(entries[2].kind).toBe('message');
    expect(entries[1].kind).toBe('system-event');
  });

  it('leaves well-formed rows untouched', () => {
    const entry = dbRowToChatEntry(
      row({
        messageType: 'tool_call',
        content: 'Read src/app.ts',
        metadata: JSON.stringify({ callId: 'call-1', name: 'Read', status: 'completed' }),
      })
    );

    expect(entry.kind).toBe('message');
    if (entry.kind !== 'message') throw new Error('expected a message entry');
    expect(entry.blocks).toEqual([
      {
        type: 'tool-call-rich',
        data: {
          callId: 'call-1',
          name: 'Read',
          status: 'completed',
          kind: 'unknown',
          summary: 'Read src/app.ts',
          content: undefined,
        },
      },
    ]);
  });
});

describe('dbRowToChatEntry system events', () => {
  it('stamps commit events with the row time so they sort chronologically', () => {
    const entry = dbRowToChatEntry(
      row({
        messageType: 'commit',
        content: 'add parser',
        metadata: JSON.stringify({ commitHash: 'deadbee' }),
        createdAt: 1_700_000_500,
        createdAtMs: 1_700_000_500_250,
      })
    );

    expect(entry).toEqual({
      kind: 'system-event',
      id: 'row-1',
      commitHash: 'deadbee',
      message: 'add parser',
      createdAt: 1_700_000_500,
      createdAtMs: 1_700_000_500_250,
    });
  });

  it('ignores a commitHash that is not a string', () => {
    const entry = dbRowToChatEntry(
      row({ messageType: 'commit', metadata: JSON.stringify({ commitHash: 42 }) })
    );

    if (entry.kind !== 'system-event') throw new Error('expected a system-event entry');
    expect(entry.commitHash).toBe('');
    expect(entry.degraded).toBeUndefined();
  });

  it('stamps agent_turn placeholder rows with the row time', () => {
    const entry = dbRowToChatEntry(row({ messageType: 'agent_turn', createdAt: 1_700_000_900 }));

    if (entry.kind !== 'system-event') throw new Error('expected a system-event entry');
    expect(entry.createdAt).toBe(1_700_000_900);
  });
});

describe('dbRowToChatEntry milliseconds (devstation-vihv)', () => {
  it("carries the row's milliseconds onto every kind of entry", () => {
    expect(dbRowToChatEntry(row({})).createdAtMs).toBe(1_700_000_000_123);
    expect(dbRowToChatEntry(row({ messageType: 'agent_turn' })).createdAtMs).toBe(
      1_700_000_000_123
    );
    expect(dbRowToChatEntry(row({ messageType: 'tool_call', metadata: '{x' })).createdAtMs).toBe(
      1_700_000_000_123
    );
  });
});

describe('dbRowToChatEntry session provenance', () => {
  it('carries the row session id onto message and system entries', () => {
    expect(dbRowToChatEntry(row({ sessionId: 'sess-1' })).sessionId).toBe('sess-1');
    expect(
      dbRowToChatEntry(row({ sessionId: 'sess-1', senderType: 'system', content: 'x' })).sessionId
    ).toBe('sess-1');
  });

  it('omits the session id for a row without one', () => {
    expect(dbRowToChatEntry(row({ sessionId: null }))).not.toHaveProperty('sessionId');
  });
});

describe('sessionCloudEntries', () => {
  const cloud = (id: string, session_id: string | null) => ({
    id,
    work_item_id: 'wi-1',
    session_id,
    sender_id: null,
    sender_type: 'agent' as const,
    sender_name: null,
    content: 'hi',
    message_type: 'text' as const,
    metadata: {},
    created_at: '2026-09-14T00:00:00.250Z',
  });

  it('keeps only the rows of the given session, with the session id on each entry', () => {
    const entries = sessionCloudEntries(
      [cloud('a', 'sess-1'), cloud('b', 'sess-2'), cloud('c', null)],
      'sess-1'
    );
    expect(entries.map((e) => [e.id, e.sessionId])).toEqual([['a', 'sess-1']]);
    expect(entries[0].createdAt).toBe(Date.parse('2026-09-14T00:00:00.000Z') / 1000);
    // The cloud keeps milliseconds; so does the entry, so same-second rows keep their order.
    expect(entries[0].createdAtMs).toBe(Date.parse('2026-09-14T00:00:00.250Z'));
  });
});

describe('dbRowToChatEntry history reset marker', () => {
  const marker = row({
    id: 'marker-1',
    sessionId: 'sess-1',
    senderType: 'system',
    senderId: null,
    senderName: 'Chord',
    messageType: 'system',
    content: 'Reset to an earlier turn. Claude no longer remembers what came after it.',
    metadata: JSON.stringify({ event: 'history_reset', targetTurnId: 'turn-1' }),
  });

  it('carries the reset and the turn it went back to', () => {
    const entry = dbRowToChatEntry(marker);

    expect(entry).toMatchObject({
      kind: 'system-event',
      id: 'marker-1',
      sessionId: 'sess-1',
      message: 'Reset to an earlier turn. Claude no longer remembers what came after it.',
      event: { type: 'history_reset', targetTurnId: 'turn-1' },
    });
  });

  it('reads the same from a teammate’s cloud copy', () => {
    const [entry] = sessionCloudEntries(
      [
        {
          id: 'marker-1',
          work_item_id: 'wi-1',
          session_id: 'sess-1',
          sender_id: null,
          sender_type: 'system' as const,
          sender_name: 'Chord',
          content: 'Reset to an earlier turn.',
          message_type: 'system' as const,
          metadata: { event: 'history_reset', targetTurnId: 'turn-1' },
          created_at: '2026-10-05T00:00:00.000Z',
        },
      ],
      'sess-1'
    );
    expect(entry).toMatchObject({
      kind: 'system-event',
      event: { type: 'history_reset', targetTurnId: 'turn-1' },
    });
  });

  it('is a plain system line when the target is missing', () => {
    const entry = dbRowToChatEntry({
      ...marker,
      metadata: JSON.stringify({ event: 'history_reset' }),
    });
    if (entry.kind !== 'system-event') throw new Error('expected a system-event entry');
    expect(entry.event).toBeUndefined();
    expect(entry.message).toBe(marker.content);
  });
});

describe('dbRowToChatEntry forked-from head', () => {
  it('names the chat and the turn time it was forked from', () => {
    const entry = dbRowToChatEntry(
      row({
        id: 'head-1',
        sessionId: 'sess-fork',
        senderType: 'system',
        senderId: null,
        senderName: 'Chord',
        messageType: 'system',
        content: 'Forked from Claude Code',
        metadata: JSON.stringify({
          event: 'forked_from',
          sourceSessionId: 'sess-1',
          sourceTurnId: 'turn-1',
          sourceTitle: 'Claude Code',
          forkedAt: 1_700_000_100,
        }),
      })
    );

    expect(entry).toMatchObject({
      kind: 'system-event',
      message: 'Forked from Claude Code',
      event: { type: 'forked_from', sourceTitle: 'Claude Code', forkedAt: 1_700_000_100 },
    });
  });
});
