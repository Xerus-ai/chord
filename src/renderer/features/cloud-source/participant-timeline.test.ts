import type { CloudChatMessage } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@renderer/features/work-list/transcript-rows';
import { buildCloudTranscript } from './participant-timeline';

type Divider = Extract<TranscriptItem, { type: 'divider' }>;

function row(
  id: string,
  sessionId: string | null,
  createdAt: string,
  overrides: Partial<CloudChatMessage> = {}
): CloudChatMessage {
  return {
    id,
    work_item_id: 'item_1',
    session_id: sessionId,
    sender_id: 'user_a',
    sender_type: 'human',
    sender_name: 'a@example.com',
    content: id,
    message_type: 'text',
    metadata: {},
    created_at: createdAt,
    ...overrides,
  };
}

function dividers(items: TranscriptItem[]): Divider[] {
  return items.filter((item): item is Divider => item.type === 'divider');
}

function keys(items: TranscriptItem[]): string[] {
  return items.map((item) =>
    item.type === 'divider'
      ? `--${item.ordinal}--`
      : item.type === 'turn'
        ? item.turn.id
        : item.entry.id
  );
}

describe('buildCloudTranscript session grouping', () => {
  it('adds no dividers when every row belongs to one session', () => {
    const nodes = buildCloudTranscript([
      row('m1', 'sess_a', '2026-01-01T00:00:00.000Z'),
      row('m2', 'sess_a', '2026-01-01T00:00:01.000Z'),
    ]);
    expect(dividers(nodes)).toHaveLength(0);
    expect(nodes).toHaveLength(2);
  });

  it('adds no dividers when no row carries a session at all', () => {
    const nodes = buildCloudTranscript([
      row('m1', null, '2026-01-01T00:00:00.000Z'),
      row('m2', null, '2026-01-01T00:00:01.000Z'),
    ]);
    expect(dividers(nodes)).toHaveLength(0);
  });

  it('marks each crossing between subsessions in the merged feed', () => {
    const nodes = buildCloudTranscript([
      row('m1', 'sess_a', '2026-01-01T00:00:00.000Z'),
      row('m2', 'sess_b', '2026-01-01T00:00:02.000Z'),
    ]);
    // The first group is announced too — with two sessions in one stream,
    // "which run is this?" is unanswerable for the top block otherwise.
    expect(keys(nodes)).toEqual(['--1--', 'm1', '--2--', 'm2']);
  });

  it('keeps live participant chat (session_id null) inside the running session', () => {
    // The server stamps session_id null on ambient WS chat; grouping strictly
    // by the column would tear the conversation into alternating blocks.
    const nodes = buildCloudTranscript([
      row('m1', 'sess_a', '2026-01-01T00:00:00.000Z'),
      row('chat', null, '2026-01-01T00:00:01.000Z'),
      row('m2', 'sess_a', '2026-01-01T00:00:02.000Z'),
      row('m3', 'sess_b', '2026-01-01T00:00:03.000Z'),
    ]);
    expect(keys(nodes)).toEqual(['--1--', 'm1', 'chat', 'm2', '--2--', 'm3']);
  });

  it('reuses a session ordinal when the feed returns to an earlier session', () => {
    const nodes = buildCloudTranscript([
      row('m1', 'sess_a', '2026-01-01T00:00:00.000Z'),
      row('m2', 'sess_b', '2026-01-01T00:00:01.000Z'),
      row('m3', 'sess_a', '2026-01-01T00:00:02.000Z'),
    ]);
    expect(dividers(nodes).map((d) => d.ordinal)).toEqual([1, 2, 1]);
  });

  it('leaves rows posted before any session started ungrouped', () => {
    const nodes = buildCloudTranscript([
      row('pre', null, '2026-01-01T00:00:00.000Z'),
      row('m1', 'sess_a', '2026-01-01T00:00:01.000Z'),
      row('m2', 'sess_b', '2026-01-01T00:00:02.000Z'),
    ]);
    expect(keys(nodes)).toEqual(['pre', '--1--', 'm1', '--2--', 'm2']);
  });

  it('orders the feed by created_at, not by arrival', () => {
    const nodes = buildCloudTranscript([
      row('late', 'sess_a', '2026-01-01T00:00:05.000Z'),
      row('early', 'sess_a', '2026-01-01T00:00:01.000Z'),
    ]);
    expect(keys(nodes)).toEqual(['early', 'late']);
  });

  it('puts a prompt sent the second the previous turn finished after that turn (devstation-vihv)', () => {
    const nodes = buildCloudTranscript([
      row('p1', 'sess_a', '2026-01-01T00:00:00.100Z'),
      row('t1-row', 'sess_a', '2026-01-01T00:00:10.061Z', {
        message_type: 'agent_turn',
        sender_type: 'agent',
        metadata: {
          turnId: 't1',
          items: [{ kind: 'text', id: 'i1', text: 'OK' }],
          startedAt: Date.parse('2026-01-01T00:00:00.400Z'),
        },
      }),
      row('p2', 'sess_a', '2026-01-01T00:00:10.300Z'),
    ]);
    expect(keys(nodes)).toEqual(['p1', 't1', 'p2']);
  });

  it('drops an agent_turn row the list endpoint trimmed until it is hydrated', () => {
    const nodes = buildCloudTranscript([
      row('turn', 'sess_a', '2026-01-01T00:00:00.000Z', {
        message_type: 'agent_turn',
        sender_type: 'agent',
        metadata: { truncated: true },
      }),
    ]);
    expect(nodes).toHaveLength(0);
  });

  it('rebuilds a hydrated agent_turn row into a turn item', () => {
    const nodes = buildCloudTranscript([
      row('turn', 'sess_a', '2026-01-01T00:00:00.000Z', {
        message_type: 'agent_turn',
        sender_type: 'agent',
        sender_name: 'Chord Agent',
        metadata: { turnId: 'turn_1', items: [{ kind: 'text', id: 'i1', text: 'hi' }] },
      }),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    if (node.type !== 'turn') throw new Error('expected a turn item');
    expect(node.turn.id).toBe('turn_1');
    expect(node.turn.agentName).toBe('Chord Agent');
  });

  it('survives a malformed row whose metadata is a JSON null', () => {
    const nodes = buildCloudTranscript([
      row('m1', 'sess_a', '2026-01-01T00:00:00.000Z', {
        metadata: null as unknown as Record<string, unknown>,
      }),
    ]);
    expect(nodes).toHaveLength(1);
  });

  it('carries the command a prompt row was sent as, for its status chip', () => {
    const [item] = buildCloudTranscript([
      row('m1', 'sess_a', '2026-01-01T00:00:00.000Z', { metadata: { command_id: 'cmd_1' } }),
    ]);
    if (item.type !== 'message') throw new Error('expected a message item');
    expect(item.commandId).toBe('cmd_1');
  });

  it('shows agent chat rows only in a history that has no turns (pty era)', () => {
    const reply = row('reply', 'sess_a', '2026-01-01T00:00:01.000Z', { sender_type: 'agent' });
    const turn = row('turn', 'sess_a', '2026-01-01T00:00:02.000Z', {
      message_type: 'agent_turn',
      sender_type: 'agent',
      metadata: { turnId: 'turn_1', items: [{ kind: 'text', id: 'i1', text: 'hi' }] },
    });
    const prompt = row('prompt', 'sess_a', '2026-01-01T00:00:00.000Z');

    expect(keys(buildCloudTranscript([prompt, reply]))).toEqual(['prompt', 'reply']);
    expect(keys(buildCloudTranscript([prompt, reply, turn]))).toEqual(['prompt', 'turn_1']);
  });
});
