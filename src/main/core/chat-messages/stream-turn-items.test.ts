import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnStreamEvent } from '@shared/stream-items';

const emitted: TurnStreamEvent[] = [];

vi.mock('@main/lib/events', () => ({
  events: {
    emit: (_channel: unknown, data: TurnStreamEvent) => emitted.push(data),
  },
}));

const { TurnItemStream, resetSessionEpoch, clearSessionEpoch } = await import(
  './stream-turn-items'
);

describe('TurnItemStream session provenance', () => {
  beforeEach(() => {
    emitted.length = 0;
    clearSessionEpoch('wi-1');
  });

  it('stamps the session id on every emitted event', () => {
    const stream = new TurnItemStream();
    stream.setSessionId('session-a');
    stream.emitTurnStarted('wi-1', 'Agent', 1000);
    stream.add('wi-1', { kind: 'text', id: 't1', text: 'hi' });
    stream.add('wi-1', { kind: 'thinking', id: 'th1', text: 'x', status: 'loading', startedAt: 1 });
    stream.flush();
    stream.add('wi-1', { kind: 'error', id: 'e1', message: 'boom' });
    stream.emitTurnCompleted('wi-1', 2000);

    expect(emitted.map((e) => e.action.type)).toEqual([
      'turn_started',
      'items_batch',
      'item_added',
      'turn_completed',
    ]);
    expect(emitted.every((e) => e.sessionId === 'session-a')).toBe(true);
  });

  it('leaves sessionId undefined when the stream has no session', () => {
    const stream = new TurnItemStream();
    stream.emitTurnStarted('wi-1', 'Agent', 1000);
    expect(emitted[0].sessionId).toBeUndefined();
  });

  it('gives sibling sessions of one work item a single ordered sequence', () => {
    const a = new TurnItemStream();
    a.setSessionId('session-a');
    const b = new TurnItemStream();
    b.setSessionId('session-b');

    resetSessionEpoch('wi-1');
    a.emitTurnStarted('wi-1', 'A', 1);
    b.emitTurnStarted('wi-1', 'B', 2);
    a.add('wi-1', { kind: 'error', id: 'e1', message: 'a' });
    b.emitTurnCompleted('wi-1', 3);

    expect(emitted.map((e) => [e.sessionId, e.seq])).toEqual([
      ['session-a', 1],
      ['session-b', 2],
      ['session-a', 3],
      ['session-b', 4],
    ]);
    expect(new Set(emitted.map((e) => e.epoch)).size).toBe(1);
  });
});

describe('TurnItemStream error tracking', () => {
  it('is not errored by default', () => {
    const stream = new TurnItemStream();
    expect(stream.isErrored).toBe(false);
  });

  it('marks the turn errored and clears it on the next turn', () => {
    const stream = new TurnItemStream();
    stream.markErrored();
    expect(stream.isErrored).toBe(true);
    stream.startNextTurn();
    expect(stream.isErrored).toBe(false);
  });
});
