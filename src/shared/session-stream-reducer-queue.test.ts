import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamReducerQueue,
  reconcileOptimisticMessages,
  replaceFromCanonical,
  type SessionStreamState,
  type TimelineCursor,
} from './session-stream-reducers';
import type { AgentTurn } from './stream-items';

describe('createStreamReducerQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches events and flushes after 48ms', () => {
    const state: SessionStreamState = { turns: new Map(), cursor: undefined };
    const commits: SessionStreamState[] = [];
    const sideEffects: unknown[] = [];

    const queue = createStreamReducerQueue({
      getState: () => state,
      commit: (output) => {
        state.turns = output.turns;
        state.cursor = output.cursor;
        commits.push({ ...state });
      },
      handleSideEffects: (effects) => sideEffects.push(...effects),
    });

    queue.enqueue('t1', 'wi-1', {
      action: { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 },
      seq: 1,
      epoch: 'e1',
      timestamp: Date.now(),
    });

    queue.enqueue('t1', 'wi-1', {
      action: { type: 'item_added', item: { kind: 'text', id: 'i1', text: 'Hi' } },
      seq: 2,
      epoch: 'e1',
      timestamp: Date.now(),
    });

    expect(commits).toHaveLength(0);

    vi.advanceTimersByTime(48);

    expect(commits).toHaveLength(1);
    expect(state.turns.get('t1')!.items).toHaveLength(1);
    expect(state.cursor!.endSeq).toBe(2);

    queue.dispose();
  });

  it('flush() processes immediately', () => {
    const state: SessionStreamState = { turns: new Map(), cursor: undefined };

    const queue = createStreamReducerQueue({
      getState: () => state,
      commit: (output) => {
        state.turns = output.turns;
        state.cursor = output.cursor;
      },
      handleSideEffects: () => {},
    });

    queue.enqueue('t1', 'wi-1', {
      action: { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 },
      seq: 1,
      epoch: 'e1',
      timestamp: Date.now(),
    });

    queue.flush();

    expect(state.turns.size).toBe(1);
    queue.dispose();
  });

  it('dispose with flush:true processes pending events', () => {
    const state: SessionStreamState = { turns: new Map(), cursor: undefined };

    const queue = createStreamReducerQueue({
      getState: () => state,
      commit: (output) => {
        state.turns = output.turns;
      },
      handleSideEffects: () => {},
    });

    queue.enqueue('t1', 'wi-1', {
      action: { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 },
      timestamp: Date.now(),
    });

    queue.dispose({ flush: true });

    expect(state.turns.size).toBe(1);
  });

  it('dispose without flush discards pending events', () => {
    const state: SessionStreamState = { turns: new Map(), cursor: undefined };

    const queue = createStreamReducerQueue({
      getState: () => state,
      commit: (output) => {
        state.turns = output.turns;
      },
      handleSideEffects: () => {},
    });

    queue.enqueue('t1', 'wi-1', {
      action: { type: 'turn_started', agentName: 'Claude', timestamp: 1000000 },
      timestamp: Date.now(),
    });

    queue.dispose();
    vi.advanceTimersByTime(100);

    expect(state.turns.size).toBe(0);
  });
});

describe('replaceFromCanonical', () => {
  it('replaces state with canonical turns', () => {
    const canonical = new Map<string, AgentTurn>([
      [
        't1',
        {
          id: 't1',
          workItemId: 'wi-1',
          agentName: 'Claude',
          items: [{ kind: 'text', id: 'i1', text: 'Done' }],
          status: 'complete',
          timestamp: 1000,
        },
      ],
    ]);

    const output = replaceFromCanonical(canonical, null);

    expect(output.turns.size).toBe(1);
    expect(output.turns.get('t1')!.status).toBe('complete');
    expect(output.cursorChanged).toBe(true);
    expect(output.sideEffects).toEqual([{ type: 'flush_pending' }]);
  });

  it('preserves cursor when provided', () => {
    const cursor: TimelineCursor = { epoch: 'e1', startSeq: 1, endSeq: 10 };
    const output = replaceFromCanonical(new Map(), cursor);

    expect(output.cursor).toEqual(cursor);
  });
});

describe('reconcileOptimisticMessages', () => {
  it('returns canonical items when no optimistic messages', () => {
    const items = [{ kind: 'text' as const, id: 'i1', text: 'Hello' }];
    const result = reconcileOptimisticMessages(items, []);
    expect(result).toBe(items);
  });

  it('appends optimistic messages not in canonical', () => {
    const items = [{ kind: 'text' as const, id: 'i1', text: 'Hello' }];
    const optimistic = [{ id: 'opt-1', text: 'User msg', timestamp: 1000 }];
    const result = reconcileOptimisticMessages(items, optimistic);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ kind: 'text', id: 'opt-1', text: 'User msg' });
  });

  it('skips optimistic messages already in canonical', () => {
    const items = [{ kind: 'text' as const, id: 'opt-1', text: 'Already there' }];
    const optimistic = [{ id: 'opt-1', text: 'User msg', timestamp: 1000 }];
    const result = reconcileOptimisticMessages(items, optimistic);

    expect(result).toHaveLength(1);
  });
});
