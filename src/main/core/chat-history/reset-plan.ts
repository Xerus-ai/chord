import { ok, type Result } from '@shared/result';
import { getActiveSession } from '@main/core/work-items/active-sessions';
import { findWorktreeRow, getPrimaryWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import type { HistoryPoint } from './fork-conversation';
import {
  checkLanePresent,
  findChatTurn,
  findTurnCheckpoint,
  refuseHistory,
  resolveHistoryPoint,
  type HistoryRefusal,
} from './history-point';

/** Everything a Reset to `turnId` needs, checked before anything changes. */
export interface HistoryResetPlan extends HistoryPoint {
  workItemId: string;
  turnId: string;
  sessionId: string;
  agentName: string;
  checkpointId: string;
}

/**
 * Whether the chat can go back to `turnId`, files and conversation both
 * (plan §"Decisions for Phase 5", Reset to here). Refused, with the reason,
 * when the turn or its checkpoint is missing, the lane is archived or not on
 * this machine, the agent has no point in its conversation to go back to
 * (an ACP agent, a turn from before history refs: "Reset files to here"
 * covers those), or a turn is still running.
 *
 * The lane is the one the turn's checkpoint was taken in, which
 * `completeTurn` resolves from the chat's own worktree: the chat's cwd.
 */
export function planHistoryReset(
  workItemId: string,
  turnId: string
): Result<HistoryResetPlan, HistoryRefusal> {
  const chatTurn = findChatTurn(workItemId, turnId);
  if (!chatTurn.success) return chatTurn;

  const checkpoint = findTurnCheckpoint(workItemId, turnId);
  if (!checkpoint) {
    return refuseHistory('no_checkpoint', 'No checkpoint was saved after this turn.');
  }

  const lane = checkLanePresent(
    checkpoint.worktreeId
      ? findWorktreeRow(checkpoint.worktreeId)
      : getPrimaryWorktreeRow(workItemId)
  );
  if (!lane.success) return lane;

  const point = resolveHistoryPoint(chatTurn.data, lane.data.path);
  if (!point.success) {
    return refuseHistory('no_history_point', `${point.error.message} Reset files to here instead.`);
  }

  const { session } = chatTurn.data;
  if (getActiveSession(session.id)?.bridge?.hasTurnInFlight()) {
    return refuseHistory(
      'turn_running',
      `Reset is available when ${point.data.agentName} finishes.`
    );
  }

  return ok({
    ...point.data,
    workItemId,
    turnId,
    sessionId: session.id,
    checkpointId: checkpoint.id,
  });
}
