import { describe, expect, it } from 'vitest';
import { processStreamEvents, type SequencedStreamEvent } from './session-stream-reducers';
import type { TurnStreamAction } from './stream-items';

function ev(
  turnId: string,
  sessionId: string,
  epoch: string,
  seq: number,
  action: TurnStreamAction
): { turnId: string; workItemId: string; event: SequencedStreamEvent } {
  return { turnId, workItemId: 'wi-1', event: { action, seq, epoch, sessionId, timestamp: 0 } };
}

const text = (id: string): TurnStreamAction => ({
  type: 'item_added',
  item: { kind: 'text', id, text: id },
});

describe('processStreamEvents with several sessions in one work item', () => {
  it('attributes interleaved turns to their sessions without catch-up', () => {
    const out = processStreamEvents(
      [
        ev('turn-a', 'session-a', 'E1', 1, { type: 'turn_started', agentName: 'A', timestamp: 1 }),
        ev('turn-b', 'session-b', 'E1', 2, { type: 'turn_started', agentName: 'B', timestamp: 2 }),
        ev('turn-a', 'session-a', 'E1', 3, text('a1')),
        ev('turn-b', 'session-b', 'E1', 4, text('b1')),
      ],
      { turns: new Map(), cursor: undefined }
    );

    expect(out.sideEffects).toEqual([]);
    expect(out.turns.get('turn-a')?.sessionId).toBe('session-a');
    expect(out.turns.get('turn-b')?.sessionId).toBe('session-b');
    expect(out.turns.get('turn-a')?.items.map((i) => i.id)).toEqual(['a1']);
    expect(out.turns.get('turn-b')?.items.map((i) => i.id)).toEqual(['b1']);
  });

  it("keeps a streaming session's turn when the shared epoch restarts mid-turn", () => {
    const first = processStreamEvents(
      [
        ev('turn-a', 'session-a', 'E1', 1, { type: 'turn_started', agentName: 'A', timestamp: 1 }),
        ev('turn-a', 'session-a', 'E1', 2, text('a1')),
      ],
      { turns: new Map(), cursor: undefined }
    );
    // An epoch restart re-numbers from 1; session A's next event carries it.
    const second = processStreamEvents([ev('turn-a', 'session-a', 'E2', 1, text('a2'))], {
      turns: first.turns,
      cursor: first.cursor,
    });

    expect(second.sideEffects).toEqual([]);
    expect(second.cursor).toEqual({ epoch: 'E2', startSeq: 1, endSeq: 1 });
    expect(second.turns.get('turn-a')?.items.map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(second.turns.get('turn-a')?.sessionId).toBe('session-a');
  });
});
