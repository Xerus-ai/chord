import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '@shared/stream-items';
import { selectLatestTurn } from './latest-turn';

function makeTurn(
  id: string,
  timestamp: number,
  status: AgentTurn['status'] = 'complete'
): AgentTurn {
  return {
    id,
    workItemId: 'wi-1',
    agentName: 'Claude',
    items: [],
    status,
    timestamp,
  };
}

describe('selectLatestTurn', () => {
  it('returns undefined for an empty list', () => {
    expect(selectLatestTurn([])).toBeUndefined();
  });

  it('returns the turn with the greatest timestamp', () => {
    const turns = [makeTurn('a', 100), makeTurn('b', 300), makeTurn('c', 200)];
    expect(selectLatestTurn(turns)?.id).toBe('b');
  });

  it('ignores array position when the newest turn is seeded first', () => {
    // The canonical seed can insert an in-flight turn ahead of older
    // persisted turns — the regression H4 describes.
    const turns = [makeTurn('live', 500, 'streaming'), makeTurn('old', 100), makeTurn('older', 50)];
    expect(selectLatestTurn(turns)?.id).toBe('live');
  });

  it('keeps the later entry when timestamps tie', () => {
    const turns = [makeTurn('first', 100), makeTurn('second', 100)];
    expect(selectLatestTurn(turns)?.id).toBe('second');
  });

  it('returns the only turn in a single-turn list', () => {
    expect(selectLatestTurn([makeTurn('solo', 42)])?.id).toBe('solo');
  });
});
