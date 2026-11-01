import { countRememberedLaterTurns, findForgottenRows } from './history-reset-rows';
import type { ResetMode } from './reset-turn-control';
import type { TranscriptItem } from './transcript-rows';

/** What a turn footer's Reset offers, and what it does. */
export interface TurnResetAction {
  mode: ResetMode;
  laterTurns: number;
  waitReason: string | null;
  checkpointId: string;
  onReset: () => Promise<void>;
}

/**
 * A finished turn's footer actions: Reset where it has a checkpoint, Fork to
 * new tab where it has a history ref, Fork to new worktree where it has both,
 * and one line saying why Reset is missing otherwise.
 */
export interface TurnHistoryAction {
  reset: TurnResetAction | null;
  forkToNewTab: (() => Promise<void>) | null;
  forkToNewWorktree: (() => Promise<void>) | null;
  unavailable: string | null;
}

/** The owner's ways to go back to, or branch from, a turn. */
export interface TurnHistoryHandlers {
  byTurnId: ReadonlyMap<string, { id: string }>;
  /** Restores the turn's checkpoint only. */
  revert: (checkpointId: string) => Promise<void>;
  /** Restores the checkpoint and forks the agent's conversation at the turn. */
  resetToTurn: (turnId: string) => Promise<void>;
  /** A new chat on the same lane, its conversation forked at the turn. */
  forkToNewTab: (turnId: string) => Promise<void>;
  /** A new lane from the turn's checkpoint, with a chat forked at the turn. */
  forkToNewWorktree: (turnId: string) => Promise<void>;
}

interface ActionShape {
  reset: Omit<TurnResetAction, 'onReset'> | null;
  canFork: boolean;
  canForkToWorktree: boolean;
  unavailable: string | null;
}

function sameShape(kept: TurnHistoryAction, next: ActionShape): boolean {
  const reset = kept.reset;
  const sameReset =
    reset === null || next.reset === null
      ? reset === next.reset
      : reset.mode === next.reset.mode &&
        reset.laterTurns === next.reset.laterTurns &&
        reset.waitReason === next.reset.waitReason &&
        reset.checkpointId === next.reset.checkpointId;
  return (
    sameReset &&
    (kept.forkToNewTab !== null) === next.canFork &&
    (kept.forkToNewWorktree !== null) === next.canForkToWorktree &&
    kept.unavailable === next.unavailable
  );
}

/** Why a turn's footer has no Reset: no checkpoint was saved for it. */
function describeUnavailable(hasCheckpoint: boolean, canFork: boolean): string | null {
  if (hasCheckpoint) return null;
  return canFork
    ? "No checkpoint was saved for this turn, so it can't be reset."
    : "No checkpoint was saved for this turn, so it can't be reset or forked.";
}

/**
 * Each finished turn's history actions, by turn id. Reset needs the turn's
 * checkpoint: with a history ref it resets files and memory, without one
 * (an ACP agent, a turn from before history refs) files only, and it waits
 * while the session has a turn running. Fork to new tab needs only the
 * history ref; Fork to new worktree needs the checkpoint too. A turn with no
 * checkpoint gets one line saying so.
 *
 * Rebuilt on every streaming update, so a turn whose actions did not change
 * keeps its `previous` object: the memoized turn rows only re-render when
 * theirs did. `previous` must come from the same `handlers`.
 */
export function buildTurnHistoryActions(
  items: readonly TranscriptItem[],
  handlers: TurnHistoryHandlers,
  previous: ReadonlyMap<string, TurnHistoryAction>
): ReadonlyMap<string, TurnHistoryAction> {
  const runningAgentBySession = new Map<string | undefined, string>();
  for (const item of items) {
    if (item.type === 'turn' && item.turn.status === 'streaming') {
      runningAgentBySession.set(item.turn.sessionId, item.turn.agentName);
    }
  }

  const laterTurns = countRememberedLaterTurns(items);
  // A Reset cleared the history refs of the turns it dropped
  // (rebase-history-refs.ts); turns loaded before it still carry them.
  const forgotten = findForgottenRows(items);
  const actions = new Map<string, TurnHistoryAction>();
  items.forEach((item, index) => {
    if (item.type !== 'turn' || item.turn.status !== 'complete') return;
    const { turn } = item;
    const checkpoint = handlers.byTurnId.get(turn.id);
    const historyRef = forgotten.has(index) ? undefined : turn.historyRef;
    const canFork = Boolean(historyRef);
    const running = runningAgentBySession.get(turn.sessionId);
    const shape: ActionShape = {
      reset: checkpoint
        ? {
            mode: historyRef ? 'full' : 'files',
            laterTurns: laterTurns.get(turn.id) ?? 0,
            waitReason: running ? `Reset is available when ${running} finishes` : null,
            checkpointId: checkpoint.id,
          }
        : null,
      canFork,
      canForkToWorktree: canFork && checkpoint !== undefined,
      unavailable: describeUnavailable(checkpoint !== undefined, canFork),
    };
    const kept = previous.get(turn.id);
    if (kept && sameShape(kept, shape)) {
      actions.set(turn.id, kept);
      return;
    }
    const reset = shape.reset;
    actions.set(turn.id, {
      reset: reset
        ? {
            ...reset,
            onReset:
              reset.mode === 'full'
                ? () => handlers.resetToTurn(turn.id)
                : () => handlers.revert(reset.checkpointId),
          }
        : null,
      forkToNewTab: canFork ? () => handlers.forkToNewTab(turn.id) : null,
      forkToNewWorktree: shape.canForkToWorktree ? () => handlers.forkToNewWorktree(turn.id) : null,
      unavailable: shape.unavailable,
    });
  });
  return actions;
}
