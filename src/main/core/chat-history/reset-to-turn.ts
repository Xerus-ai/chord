import { ok, type Result } from '@shared/result';
import { runExclusivePerSession } from '@main/core/chat-messages/send-locks';
import { revertToCheckpoint } from '@main/core/checkpoints/checkpoint-service';
import { recordChatExternalId } from '@main/core/work-items/chat-resume-state';
import { stopSession } from '@main/core/work-items/session-service';
import { log } from '@main/lib/logger';
import { forkConversationAtTurn } from './fork-conversation';
import type { HistoryRefusal } from './history-point';
import { rebaseSessionHistoryRefs } from './rebase-history-refs';
import { recordHistoryReset } from './record-history-reset';
import { planHistoryReset } from './reset-plan';

export interface HistoryResetOutcome {
  /** The forked conversation the chat now resumes. */
  forkedExternalId: string;
  /** The checkpoint holding the files as they were before the Reset. */
  safetyCheckpointId: string | null;
  /** The chat row announcing the Reset. */
  markerId: string;
}

/**
 * Reset to here (plan §"Decisions for Phase 5"): the lane's files go back to
 * after `turnId`, and the chat's conversation is forked at that turn and
 * rebound, so the next message resumes an agent that remembers nothing
 * later. Nothing is destroyed: the current files become a `pre_revert`
 * checkpoint, the old conversation stays on disk, and the chat keeps every
 * row, with a marker the renderer dims the forgotten turns under.
 *
 * Runs under the session's send lock, so a send cannot start the agent
 * between the checks and the rebind. The fork comes before the files: if it
 * fails, the chat has only been stopped, and the next send resumes it as it
 * was. Reset starts no agent: the chat stays stopped, reads "ready", and the
 * next send resumes the fork, restarting the query on that prompt
 * (devstation-6z4o).
 */
export function resetToTurn(args: {
  workItemId: string;
  turnId: string;
}): Promise<Result<HistoryResetOutcome, HistoryRefusal>> {
  const planned = planHistoryReset(args.workItemId, args.turnId);
  if (!planned.success) return Promise.resolve(planned);

  return runExclusivePerSession(planned.data.sessionId, async () => {
    // Checked again inside the lock: a send queued ahead may have started a turn.
    const again = planHistoryReset(args.workItemId, args.turnId);
    if (!again.success) return again;
    const plan = again.data;

    await stopSession(plan.sessionId);
    const fork = await forkConversationAtTurn(plan);
    const forkedExternalId = fork.externalId;
    const { safetyCheckpointId } = await revertToCheckpoint(plan.workItemId, plan.checkpointId);
    recordChatExternalId(plan.sessionId, forkedExternalId);
    // The turns now name entries of the fork; the forgotten ones name none.
    rebaseSessionHistoryRefs(plan.sessionId, plan.turnId, fork.mapRef);
    const markerId = await recordHistoryReset({
      workItemId: plan.workItemId,
      sessionId: plan.sessionId,
      targetTurnId: plan.turnId,
      agentName: plan.agentName,
    });
    log.info('[chat-history] reset to turn', {
      workItemId: plan.workItemId,
      sessionId: plan.sessionId,
      turnId: plan.turnId,
      from: plan.externalSessionId,
      to: forkedExternalId,
    });
    return ok({ forkedExternalId, safetyCheckpointId, markerId });
  });
}
