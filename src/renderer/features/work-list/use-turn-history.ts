import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { checkpointSavedChannel } from '@shared/events/checkpointEvents';
import type { CheckpointRow } from '@main/db/schema-checkpoints';
import { events, rpc } from '@renderer/lib/ipc';
import { describeRpcFailure } from './describe-action-failure';
import type { TurnHistoryHandlers } from './turn-history-actions';

function openSessionTab(sessionId: string): void {
  window.dispatchEvent(
    new CustomEvent('chord:switch-tab', { detail: { kind: 'session', sessionId } })
  );
}

/**
 * The owner's history actions for the chat timeline: per-turn checkpoints
 * (git snapshots the main process saves just after a turn ends, read again on
 * each `checkpoint:saved`, so a footer never says a turn has none while it is
 * being saved), Reset, and Fork.
 */
export function useTurnHistory(workItemId: string | undefined): TurnHistoryHandlers {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['workItem', 'checkpoints', workItemId],
    queryFn: async () => {
      const result = await rpc.checkpoints.list(workItemId!);
      if (!result.success) {
        throw new Error(describeRpcFailure('Load checkpoints', result.error));
      }
      return result.data.checkpoints;
    },
    enabled: !!workItemId,
  });

  useEffect(() => {
    if (!workItemId) return;
    return events.on(checkpointSavedChannel, (saved) => {
      if (saved.workItemId !== workItemId) return;
      void queryClient.invalidateQueries({ queryKey: ['workItem', 'checkpoints', workItemId] });
    });
  }, [workItemId, queryClient]);

  const checkpointsByTurnId = useMemo(() => {
    const byTurn = new Map<string, CheckpointRow>();
    for (const checkpoint of data ?? []) {
      if (checkpoint.turnId && checkpoint.trigger === 'turn_completed') {
        byTurn.set(checkpoint.turnId, checkpoint);
      }
    }
    return byTurn;
  }, [data]);

  // A revert rewrites the worktree, so every open diff and file tab is
  // showing pre-revert content — the prefix keys match all of their paths.
  const refreshAfterRevert = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workItem', 'gitStatus', workItemId] }),
      queryClient.invalidateQueries({ queryKey: ['workItem', 'checkpoints', workItemId] }),
      queryClient.invalidateQueries({ queryKey: ['workItem', 'fileDiff', workItemId] }),
      queryClient.invalidateQueries({ queryKey: ['workItem', 'fileContent', workItemId] }),
    ]);
  }, [workItemId, queryClient]);

  const revertToCheckpoint = useCallback(
    async (checkpointId: string) => {
      if (!workItemId) return;
      const result = await rpc.checkpoints.revert({ workItemId, checkpointId });
      if (!result.success) {
        throw new Error(result.error?.message ?? 'checkpoint revert failed');
      }
      await refreshAfterRevert();
    },
    [workItemId, refreshAfterRevert]
  );

  /** Reset to here: the checkpoint's files, and the agent's conversation forked at the turn. */
  const resetToTurn = useCallback(
    async (turnId: string) => {
      if (!workItemId) return;
      const result = await rpc.chatHistory.resetToTurn({ workItemId, turnId });
      if (!result.success) throw new Error(result.error.message);
      await refreshAfterRevert();
    },
    [workItemId, refreshAfterRevert]
  );

  /** Fork to new tab: a new chat on the same lane, opened once it exists. */
  const forkToNewTab = useCallback(
    async (turnId: string) => {
      if (!workItemId) return;
      const result = await rpc.chatHistory.forkToNewTab({ workItemId, turnId });
      if (!result.success) throw new Error(result.error.message);
      openSessionTab(result.data.sessionId);
    },
    [workItemId]
  );

  /** Fork to new worktree: a new lane and a chat in it, opened once both exist. */
  const forkToNewWorktree = useCallback(
    async (turnId: string) => {
      if (!workItemId) return;
      const result = await rpc.chatHistory.forkToNewWorktree({ workItemId, turnId });
      if (!result.success) throw new Error(result.error.message);
      await queryClient.invalidateQueries({ queryKey: ['worktrees', 'list', workItemId] });
      openSessionTab(result.data.sessionId);
    },
    [workItemId, queryClient]
  );

  return useMemo(
    () => ({
      byTurnId: checkpointsByTurnId,
      revert: revertToCheckpoint,
      resetToTurn,
      forkToNewTab,
      forkToNewWorktree,
    }),
    [checkpointsByTurnId, revertToCheckpoint, resetToTurn, forkToNewTab, forkToNewWorktree]
  );
}
