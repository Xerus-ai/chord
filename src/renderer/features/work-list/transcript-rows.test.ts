import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '@shared/stream-items';
import type { ChatEntry } from './chat-types';
import {
  buildSessionTranscript,
  selectPendingPermission,
  selectPendingQuestion,
  selectRunningSubagents,
  selectThreadEntries,
} from './transcript-rows';

/** `createdAt` in seconds; `createdAtMs` defaults to the start of that second. */
function message(
  id: string,
  sender: 'human' | 'agent',
  createdAt: number,
  createdAtMs = createdAt * 1000
): ChatEntry {
  return {
    kind: 'message',
    id,
    sender,
    senderId: null,
    name: id,
    initials: 'X',
    time: '',
    createdAt,
    createdAtMs,
    blocks: [{ type: 'text', text: id }],
  };
}

function systemEvent(id: string, text: string, createdAt: number): ChatEntry {
  return {
    kind: 'system-event',
    id,
    commitHash: '',
    message: text,
    createdAt,
    createdAtMs: createdAt * 1000,
  };
}

/** `timestamp` in seconds (when the turn was recorded); `startedAt` in ms. */
function turn(
  id: string,
  sessionId: string | undefined,
  timestamp: number,
  startedAt?: number
): AgentTurn {
  return {
    id,
    workItemId: 'wi',
    sessionId,
    agentName: 'Claude',
    items: [],
    status: 'complete',
    timestamp,
    startedAt,
  };
}

describe('selectThreadEntries', () => {
  it('keeps human and system rows and drops agent rows and turn placeholders', () => {
    const entries = [
      message('h1', 'human', 1),
      message('a1', 'agent', 2),
      systemEvent('commit', 'Committed abc', 3),
      systemEvent('turn-placeholder', '', 4),
    ];
    expect(selectThreadEntries(entries).map((e) => e.id)).toEqual(['h1', 'commit']);
  });
});

describe('buildSessionTranscript', () => {
  it('interleaves prompts and turns by time, prompt first on a tie', () => {
    const items = buildSessionTranscript(
      [message('p2', 'human', 20), message('p1', 'human', 10), message('legacy', 'agent', 15)],
      [turn('t1', 's1', 10)]
    );
    expect(items.map((i) => (i.type === 'turn' ? i.turn.id : i.entry.id))).toEqual([
      'p1',
      't1',
      'p2',
    ]);
  });
});

describe('buildSessionTranscript ordering within a second (devstation-vihv)', () => {
  const order = (items: ReturnType<typeof buildSessionTranscript>) =>
    items.map((i) => (i.type === 'turn' ? i.turn.id : i.entry.id));

  it('puts a prompt sent the second its previous turn finished after that turn', () => {
    // Codex finished turn 1 at 1010.061 s; prompt 2 went out at 1010.300 s.
    const items = buildSessionTranscript(
      [message('p1', 'human', 1000, 1_000_100), message('p2', 'human', 1010, 1_010_300)],
      [turn('t1', 's1', 1010, 1_000_400), turn('t2', 's1', 1017, 1_010_500)]
    );
    expect(order(items)).toEqual(['p1', 't1', 'p2', 't2']);
  });

  it('orders a sub-second turn between its prompt and the next one in the same second', () => {
    const items = buildSessionTranscript(
      [message('ask', 'human', 2000, 2_000_100), message('next', 'human', 2000, 2_000_900)],
      [turn('answer', 's1', 2000, 2_000_200)]
    );
    expect(order(items)).toEqual(['ask', 'answer', 'next']);
  });

  it('sorts a turn by when it was recorded when it has no start time', () => {
    const items = buildSessionTranscript(
      [message('p1', 'human', 3000, 3_000_100), message('p2', 'human', 3005, 3_005_100)],
      [turn('legacy', 's1', 3002)]
    );
    expect(order(items)).toEqual(['p1', 'legacy', 'p2']);
  });
});

describe('selectPendingPermission', () => {
  const permission = (id: string, resolved?: boolean): AgentTurn['items'][number] => ({
    kind: 'permission',
    id,
    requestId: `r-${id}`,
    name: 'Bash',
    title: 'Run',
    options: [],
    resolved,
  });

  it('returns the newest unresolved request of a streaming turn', () => {
    const t = { ...turn('t', 's1', 1), status: 'streaming' as const };
    t.items = [permission('p1'), permission('p2', true)];
    expect(selectPendingPermission(t, null)?.id).toBe('p1');
  });

  it('skips a dismissed request and ignores completed turns', () => {
    const t = { ...turn('t', 's1', 1), status: 'streaming' as const, items: [permission('p1')] };
    expect(selectPendingPermission(t, 'p1')).toBeNull();
    expect(selectPendingPermission({ ...t, status: 'complete' }, null)).toBeNull();
  });
});

describe('selectPendingQuestion', () => {
  const question = (
    id: string,
    status: 'pending' | 'answered' | 'dismissed'
  ): AgentTurn['items'][number] => ({
    kind: 'question',
    id,
    requestId: `r-${id}`,
    questions: [],
    status,
  });

  it('returns the newest pending question of a streaming turn', () => {
    const t = { ...turn('t', 's1', 1), status: 'streaming' as const };
    t.items = [question('q1', 'answered'), question('q2', 'pending')];
    expect(selectPendingQuestion(t)?.id).toBe('q2');
  });

  it('ignores settled questions and completed turns', () => {
    const t = { ...turn('t', 's1', 1), status: 'streaming' as const };
    t.items = [question('q1', 'dismissed')];
    expect(selectPendingQuestion(t)).toBeNull();
    t.items = [question('q2', 'pending')];
    expect(selectPendingQuestion({ ...t, status: 'complete' })).toBeNull();
  });
});

describe('selectRunningSubagents', () => {
  it('returns running subagents of an in-flight turn only', () => {
    const agent = (agentId: string, status: 'running' | 'completed') => ({
      agentId,
      name: agentId,
      description: '',
      status,
    });
    const items: AgentTurn['items'] = [
      { kind: 'subagent', id: 'sa', agents: [agent('a', 'running'), agent('b', 'completed')] },
    ];
    const done = { ...turn('done', 's1', 1), items };
    const live = { ...turn('live', 's1', 2), status: 'streaming' as const, items };
    expect(selectRunningSubagents([done])).toEqual([]);
    expect(selectRunningSubagents([done, live]).map((a) => a.agentId)).toEqual(['a']);
  });
});
