import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '@shared/stream-items';
import type { ChatEntry } from './chat-types';
import { countRememberedTurnsAfter, findForgottenRows } from './history-reset-rows';
import type { TranscriptItem } from './transcript-rows';

function turn(
  id: string,
  sort: number,
  sessionId = 'sess-1',
  agentName = 'Claude'
): TranscriptItem {
  const value: AgentTurn = {
    id,
    workItemId: 'wi-1',
    agentName,
    items: [],
    status: 'complete',
    timestamp: sort,
    sessionId,
  };
  return { sort, type: 'turn', turn: value };
}

function prompt(id: string, sort: number, sessionId = 'sess-1'): TranscriptItem {
  const entry: ChatEntry = {
    kind: 'message',
    id,
    sender: 'human',
    senderId: 'user-1',
    sessionId,
    name: 'Ada',
    initials: 'A',
    time: '',
    createdAt: sort,
    createdAtMs: sort * 1000,
    blocks: [{ type: 'text', text: id }],
  };
  return { sort, type: 'message', entry };
}

function reset(
  id: string,
  sort: number,
  targetTurnId: string,
  sessionId = 'sess-1'
): TranscriptItem {
  const entry: ChatEntry = {
    kind: 'system-event',
    id,
    commitHash: '',
    message: 'Reset to an earlier turn.',
    sessionId,
    createdAt: sort,
    createdAtMs: sort * 1000,
    event: { type: 'history_reset', targetTurnId },
  };
  return { sort, type: 'message', entry };
}

describe('findForgottenRows', () => {
  it("dims the prompts and turns between the target turn and the reset, captioned once with the target's agent", () => {
    const items = [
      prompt('p1', 1),
      turn('t1', 2),
      prompt('p2', 3),
      turn('t2', 4),
      prompt('p3', 5),
      turn('t3', 6),
      reset('r1', 7, 't1'),
      prompt('p4', 8),
      turn('t4', 9),
    ];

    const forgotten = findForgottenRows(items);

    expect([...forgotten.keys()]).toEqual([2, 3, 4, 5]);
    expect(forgotten.get(2)).toEqual({ agentName: 'Claude', startsRun: true });
    expect(forgotten.get(3)).toEqual({ agentName: 'Claude', startsRun: false });
  });

  it("leaves another session's rows in a mixed feed alone, and starts a new caption after them", () => {
    const items = [
      turn('t1', 1),
      turn('t2', 2),
      turn('other', 3, 'sess-2', 'Codex'),
      turn('t3', 4),
      reset('r1', 5, 't1'),
    ];

    const forgotten = findForgottenRows(items);

    expect([...forgotten.keys()]).toEqual([1, 3]);
    expect(forgotten.get(3)?.startsRun).toBe(true);
  });

  it('dims nothing when the target turn is not in the list', () => {
    expect(findForgottenRows([turn('t2', 2), reset('r1', 3, 't1')]).size).toBe(0);
  });

  it('dims what each of two resets dropped', () => {
    const items = [
      turn('t1', 1),
      turn('t2', 2),
      reset('r1', 3, 't1'),
      turn('t3', 4),
      turn('t4', 5),
      reset('r2', 6, 't3'),
    ];

    expect([...findForgottenRows(items).keys()]).toEqual([1, 4]);
  });
});

describe('countRememberedTurnsAfter', () => {
  const items = [
    turn('t1', 1),
    turn('t2', 2),
    reset('r1', 3, 't1'),
    turn('t3', 4),
    turn('other', 5, 'sess-2'),
    turn('t4', 6),
  ];

  it("counts the session's later turns the agent still remembers", () => {
    expect(countRememberedTurnsAfter(items, 't3')).toBe(1);
  });

  it('skips turns an earlier reset already dropped', () => {
    expect(countRememberedTurnsAfter(items, 't1')).toBe(2);
  });

  it('is 0 for the latest turn', () => {
    expect(countRememberedTurnsAfter(items, 't4')).toBe(0);
  });
});
