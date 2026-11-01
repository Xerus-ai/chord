import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '@shared/stream-items';
import type { ChatEntry } from './chat-types';
import type { TranscriptItem } from './transcript-rows';
import { buildTurnHistoryActions, type TurnHistoryHandlers } from './turn-history-actions';

function turn(
  id: string,
  sort: number,
  opts: { historyRef?: string; status?: AgentTurn['status']; sessionId?: string } = {}
): TranscriptItem {
  return {
    sort,
    type: 'turn',
    turn: {
      id,
      workItemId: 'wi-1',
      agentName: 'Claude Code',
      items: [],
      status: opts.status ?? 'complete',
      timestamp: sort,
      sessionId: opts.sessionId ?? 'sess-1',
      historyRef: opts.historyRef,
    },
  };
}

function resetRow(id: string, sort: number, targetTurnId: string): TranscriptItem {
  const entry: ChatEntry = {
    kind: 'system-event',
    id,
    commitHash: '',
    message: 'Reset to an earlier turn.',
    sessionId: 'sess-1',
    createdAt: sort,
    createdAtMs: sort * 1000,
    event: { type: 'history_reset', targetTurnId },
  };
  return { sort, type: 'message', entry };
}

function handlers(checkpointTurnIds: string[], calls: string[] = []): TurnHistoryHandlers {
  return {
    byTurnId: new Map(checkpointTurnIds.map((id) => [id, { id: `ck-${id}` }])),
    revert: async (checkpointId) => {
      calls.push(`revert ${checkpointId}`);
    },
    resetToTurn: async (turnId) => {
      calls.push(`reset ${turnId}`);
    },
    forkToNewTab: async (turnId) => {
      calls.push(`fork ${turnId}`);
    },
    forkToNewWorktree: async (turnId) => {
      calls.push(`fork-worktree ${turnId}`);
    },
  };
}

describe('buildTurnHistoryActions', () => {
  it('offers Reset where there is a checkpoint, Fork to new tab where there is a history ref, and Fork to new worktree where there are both', () => {
    const items = [
      turn('both', 1, { historyRef: 'ref-1' }),
      turn('fork-only', 2, { historyRef: 'ref-2' }),
      turn('files-only', 3),
      turn('neither', 4),
    ];
    const actions = buildTurnHistoryActions(items, handlers(['both', 'files-only']), new Map());

    expect(actions.get('both')?.reset?.mode).toBe('full');
    expect(actions.get('both')?.forkToNewTab).not.toBeNull();
    expect(actions.get('both')?.forkToNewWorktree).not.toBeNull();
    expect(actions.get('both')?.unavailable).toBeNull();
    expect(actions.get('fork-only')?.reset).toBeNull();
    expect(actions.get('fork-only')?.forkToNewTab).not.toBeNull();
    expect(actions.get('fork-only')?.forkToNewWorktree).toBeNull();
    expect(actions.get('files-only')?.reset?.mode).toBe('files');
    expect(actions.get('files-only')?.forkToNewTab).toBeNull();
    expect(actions.get('files-only')?.forkToNewWorktree).toBeNull();
    expect(actions.get('files-only')?.unavailable).toBeNull();
    expect(actions.get('neither')?.reset).toBeNull();
    expect(actions.get('neither')?.forkToNewTab).toBeNull();
  });

  it('says in one line why a turn with no checkpoint has no Reset', () => {
    const items = [turn('fork-only', 1, { historyRef: 'ref-1' }), turn('neither', 2)];
    const actions = buildTurnHistoryActions(items, handlers([]), new Map());

    expect(actions.get('fork-only')?.unavailable).toBe(
      "No checkpoint was saved for this turn, so it can't be reset."
    );
    expect(actions.get('neither')?.unavailable).toBe(
      "No checkpoint was saved for this turn, so it can't be reset or forked."
    );
  });

  it('runs the handler for the turn', async () => {
    const calls: string[] = [];
    const items = [turn('t1', 1, { historyRef: 'ref-1' }), turn('t2', 2)];
    const actions = buildTurnHistoryActions(items, handlers(['t1', 't2'], calls), new Map());

    await actions.get('t1')?.forkToNewTab?.();
    await actions.get('t1')?.forkToNewWorktree?.();
    await actions.get('t1')?.reset?.onReset();
    await actions.get('t2')?.reset?.onReset();
    expect(calls).toEqual(['fork t1', 'fork-worktree t1', 'reset t1', 'revert ck-t2']);
  });

  it('holds Reset while the session has a turn running, but still forks', () => {
    const items = [
      turn('t1', 1, { historyRef: 'ref-1' }),
      turn('t2', 2, { historyRef: 'ref-2', status: 'streaming' }),
    ];
    const actions = buildTurnHistoryActions(items, handlers(['t1']), new Map());

    expect(actions.get('t1')?.reset?.waitReason).toBe(
      'Reset is available when Claude Code finishes'
    );
    expect(actions.get('t1')?.forkToNewTab).not.toBeNull();
    expect(actions.has('t2')).toBe(false);
  });

  // A Reset cleared the dropped turns' history refs (rebase-history-refs.ts);
  // the chat's turns were loaded before it, so their refs are stale here.
  it('offers a turn a Reset dropped only its files: no memory reset, no fork', () => {
    const items = [
      turn('t1', 1, { historyRef: 'ref-1' }),
      turn('t2', 2, { historyRef: 'ref-2' }),
      resetRow('reset-1', 3, 't1'),
    ];
    const actions = buildTurnHistoryActions(items, handlers(['t1', 't2']), new Map());

    expect(actions.get('t1')?.reset?.mode).toBe('full');
    expect(actions.get('t2')?.reset?.mode).toBe('files');
    expect(actions.get('t2')?.forkToNewTab).toBeNull();
    expect(actions.get('t2')?.forkToNewWorktree).toBeNull();
  });

  it('keeps the same object for a turn whose actions did not change', () => {
    const shared = handlers(['t1']);
    const first = buildTurnHistoryActions([turn('t1', 1, { historyRef: 'r' })], shared, new Map());
    const second = buildTurnHistoryActions(
      [turn('t1', 1, { historyRef: 'r' }), turn('t2', 2, { status: 'streaming', sessionId: 'x' })],
      shared,
      first
    );

    expect(second.get('t1')).toBe(first.get('t1'));
  });
});
