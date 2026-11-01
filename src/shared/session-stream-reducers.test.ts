import { describe, expect, it } from 'vitest';
import {
  classifySeq,
  processStreamEvents,
  type SequencedStreamEvent,
  type SessionStreamState,
} from './session-stream-reducers';
import type { TurnStreamAction } from './stream-items';

describe('classifySeq', () => {
  it('returns init when cursor is null', () => {
    expect(classifySeq(null, 'epoch-1', 1)).toBe('init');
  });

  it('returns accept for next sequential event', () => {
    const cursor = { epoch: 'epoch-1', endSeq: 5 };
    expect(classifySeq(cursor, 'epoch-1', 6)).toBe('accept');
  });

  it('returns drop_stale for already-seen seq', () => {
    const cursor = { epoch: 'epoch-1', endSeq: 5 };
    expect(classifySeq(cursor, 'epoch-1', 3)).toBe('drop_stale');
    expect(classifySeq(cursor, 'epoch-1', 5)).toBe('drop_stale');
  });

  it('returns gap when seq skips ahead', () => {
    const cursor = { epoch: 'epoch-1', endSeq: 5 };
    expect(classifySeq(cursor, 'epoch-1', 7)).toBe('gap');
    expect(classifySeq(cursor, 'epoch-1', 100)).toBe('gap');
  });

  it('returns drop_epoch for different epoch with seq > 1', () => {
    const cursor = { epoch: 'epoch-1', endSeq: 5 };
    expect(classifySeq(cursor, 'epoch-2', 10)).toBe('drop_epoch');
  });

  it('returns accept (new epoch) when different epoch starts at seq 1', () => {
    const cursor = { epoch: 'epoch-1', endSeq: 5 };
    expect(classifySeq(cursor, 'epoch-2', 1)).toBe('drop_epoch');
  });
});

describe('processStreamEvents', () => {
  const emptyState: SessionStreamState = { turns: new Map(), cursor: undefined };

  function makeEvent(
    turnId: string,
    action: TurnStreamAction,
    seq?: number,
    epoch?: string
  ): { turnId: string; workItemId: string; event: SequencedStreamEvent } {
    return {
      turnId,
      workItemId: 'wi-1',
      event: { action, seq, epoch, timestamp: Date.now() },
    };
  }

  it('applies turn_started to empty state', () => {
    const events = [
      makeEvent('t1', { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 }, 1, 'e1'),
    ];
    const output = processStreamEvents(events, emptyState);

    expect(output.turns.size).toBe(1);
    const turn = output.turns.get('t1')!;
    expect(turn.agentName).toBe('Claude');
    expect(turn.status).toBe('streaming');
    expect(turn.items).toEqual([]);
  });

  it('advances cursor on accept', () => {
    const events = [
      makeEvent('t1', { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 }, 1, 'e1'),
      makeEvent(
        't1',
        { type: 'item_added', item: { kind: 'text', id: 'i1', text: 'Hello' } },
        2,
        'e1'
      ),
    ];
    const output = processStreamEvents(events, emptyState);

    expect(output.cursor).toEqual({ epoch: 'e1', startSeq: 1, endSeq: 2 });
    expect(output.cursorChanged).toBe(true);
  });

  it('turn_started stores startedAt from the action timestamp', () => {
    const events = [
      makeEvent(
        't1',
        { type: 'turn_started', agentName: 'Claude', timestamp: 1700000000000 },
        1,
        'e1'
      ),
    ];
    const output = processStreamEvents(events, emptyState);

    expect(output.turns.get('t1')!.startedAt).toBe(1700000000000);
  });

  it('turn_completed with timestamp stores completedAt and completes the turn', () => {
    const events = [
      makeEvent(
        't1',
        { type: 'turn_started', agentName: 'Claude', timestamp: 1700000000000 },
        1,
        'e1'
      ),
      makeEvent('t1', { type: 'turn_completed', timestamp: 1700000042000 }, 2, 'e1'),
    ];
    const output = processStreamEvents(events, emptyState);

    const turn = output.turns.get('t1')!;
    expect(turn.status).toBe('complete');
    expect(turn.startedAt).toBe(1700000000000);
    expect(turn.completedAt).toBe(1700000042000);
  });

  it('turn_completed without timestamp leaves completedAt undefined', () => {
    const events = [
      makeEvent(
        't1',
        { type: 'turn_started', agentName: 'Claude', timestamp: 1700000000000 },
        1,
        'e1'
      ),
      makeEvent('t1', { type: 'turn_completed' }, 2, 'e1'),
    ];
    const output = processStreamEvents(events, emptyState);

    const turn = output.turns.get('t1')!;
    expect(turn.status).toBe('complete');
    expect(turn.completedAt).toBeUndefined();
  });

  it('drops stale events', () => {
    const state: SessionStreamState = {
      turns: new Map([
        [
          't1',
          {
            id: 't1',
            workItemId: 'wi-1',
            agentName: 'Claude',
            items: [{ kind: 'text', id: 'i1', text: 'Hello' }],
            status: 'streaming',
            timestamp: 1000,
          },
        ],
      ]),
      cursor: { epoch: 'e1', startSeq: 1, endSeq: 5 },
    };

    const events = [
      makeEvent(
        't1',
        { type: 'item_added', item: { kind: 'text', id: 'i2', text: 'Stale' } },
        3,
        'e1'
      ),
    ];
    const output = processStreamEvents(events, state);

    expect(output.turns.get('t1')!.items).toHaveLength(1);
    expect(output.sideEffects).toHaveLength(0);
  });

  it('emits catch_up side effect on gap', () => {
    const state: SessionStreamState = {
      turns: new Map(),
      cursor: { epoch: 'e1', startSeq: 1, endSeq: 5 },
    };

    const events = [
      makeEvent('t1', { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 }, 8, 'e1'),
    ];
    const output = processStreamEvents(events, state);

    expect(output.sideEffects).toHaveLength(1);
    expect(output.sideEffects[0].type).toBe('catch_up');
    expect(output.turns.size).toBe(0);
  });

  it('handles items_batch action', () => {
    const state: SessionStreamState = {
      turns: new Map([
        [
          't1',
          {
            id: 't1',
            workItemId: 'wi-1',
            agentName: 'Claude',
            items: [],
            status: 'streaming',
            timestamp: 1000,
          },
        ],
      ]),
      cursor: { epoch: 'e1', startSeq: 1, endSeq: 1 },
    };

    const batch: TurnStreamAction = {
      type: 'items_batch',
      actions: [
        { type: 'item_added', item: { kind: 'text', id: 'i1', text: 'A' } },
        { type: 'item_added', item: { kind: 'text', id: 'i2', text: 'B' } },
        { type: 'turn_completed' },
      ],
    };

    const events = [makeEvent('t1', batch, 2, 'e1')];
    const output = processStreamEvents(events, state);

    const turn = output.turns.get('t1')!;
    expect(turn.items).toHaveLength(2);
    expect(turn.status).toBe('complete');
  });

  it('processes events without seq/epoch (unsequenced)', () => {
    const events = [
      makeEvent('t1', { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 }),
    ];
    const output = processStreamEvents(events, emptyState);

    expect(output.turns.size).toBe(1);
    expect(output.cursor).toBeUndefined();
  });

  it('emits catch_up when an item event references an unknown turn', () => {
    // Mount-mid-turn: turn_started was emitted before this consumer subscribed,
    // so the first thing it sees is an item_added for a turn it doesn't know.
    const events = [
      makeEvent(
        't-missed',
        { type: 'item_added', item: { kind: 'text', id: 'i1', text: 'Hello' } },
        7,
        'e1'
      ),
    ];
    const output = processStreamEvents(events, emptyState);

    expect(output.turns.size).toBe(0);
    expect(output.sideEffects).toHaveLength(1);
    expect(output.sideEffects[0].type).toBe('catch_up');
  });

  it('emits catch_up instead of silently dropping a new epoch joined mid-stream', () => {
    const state: SessionStreamState = {
      turns: new Map(),
      cursor: { epoch: 'e1', startSeq: 1, endSeq: 5 },
    };

    const events = [
      makeEvent(
        't2',
        { type: 'item_added', item: { kind: 'text', id: 'i1', text: 'Hi' } },
        4,
        'e2'
      ),
    ];
    const output = processStreamEvents(events, state);

    expect(output.turns.size).toBe(0);
    expect(output.sideEffects.some((e) => e.type === 'catch_up')).toBe(true);
  });

  it('collapses multiple catch_up requests in one batch into one', () => {
    const state: SessionStreamState = {
      turns: new Map(),
      cursor: { epoch: 'e1', startSeq: 1, endSeq: 5 },
    };

    const events = [
      makeEvent('t1', { type: 'item_added', item: { kind: 'text', id: 'i1', text: 'A' } }, 8, 'e1'),
      makeEvent('t1', { type: 'item_added', item: { kind: 'text', id: 'i2', text: 'B' } }, 9, 'e1'),
    ];
    const output = processStreamEvents(events, state);

    expect(output.sideEffects.filter((e) => e.type === 'catch_up')).toHaveLength(1);
  });

  it('item_added replaces an existing item with the same id', () => {
    // A catch-up snapshot races the live stream: an item can arrive both in
    // the snapshot and as its original item_added event. The second arrival
    // must replace, not duplicate.
    const state: SessionStreamState = {
      turns: new Map([
        [
          't1',
          {
            id: 't1',
            workItemId: 'wi-1',
            agentName: 'Claude',
            items: [{ kind: 'text', id: 'i1', text: 'old' }],
            status: 'streaming',
            timestamp: 1000,
          },
        ],
      ]),
      cursor: { epoch: 'e1', startSeq: 1, endSeq: 1 },
    };

    const events = [
      makeEvent(
        't1',
        { type: 'item_added', item: { kind: 'text', id: 'i1', text: 'new' } },
        2,
        'e1'
      ),
    ];
    const output = processStreamEvents(events, state);

    const turn = output.turns.get('t1')!;
    expect(turn.items).toHaveLength(1);
    expect(turn.items[0]).toEqual({ kind: 'text', id: 'i1', text: 'new' });
  });
});
