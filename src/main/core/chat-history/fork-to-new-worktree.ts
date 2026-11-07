import { resolve } from 'node:path';
import { ok, type Result } from '@shared/result';
import { deleteWorktree } from '@main/core/worktrees/delete-worktree';
import { createWorktree, type CreateWorktreeError } from '@main/core/worktrees/service';
import { laneSessionCwd, resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { log } from '@main/lib/logger';
import { createForkedChat } from './create-forked-chat';
import { forkConversationAtTurn, type ForkedConversation } from './fork-conversation';
import {
  findChatTurn,
  findTurnCheckpoint,
  refuseHistory,
  resolveHistoryPoint,
  type HistoryRefusal,
} from './history-point';

function describeCreateError(error: CreateWorktreeError): string {
  switch (error.type) {
    case 'work_item_not_found':
      return 'This work item is not on this device.';
    case 'no_source_branch':
      return "The work item's checkout is not on a branch, so a lane can't be named after it.";
    default:
      return error.message;
  }
}

/**
 * Fork to new worktree (plan §"Decisions for Phase 5"): a new lane in the
 * same work item, made from the turn checkpoint's parent commit (the lane's
 * HEAD at that turn) with the checkpoint's files applied uncommitted, and a
 * new chat of the same agent there, resuming the conversation forked at the
 * turn in the new checkout. Nothing needs the source checkout, so it works
 * from an archived lane's turn. If the conversation can't be forked, the new
 * lane is deleted again. Returns the new chat and lane, for the renderer to
 * open.
 */
export async function forkToNewWorktree(args: {
  workItemId: string;
  turnId: string;
}): Promise<Result<{ sessionId: string; worktreeId: string }, HistoryRefusal>> {
  const chatTurn = findChatTurn(args.workItemId, args.turnId);
  if (!chatTurn.success) return chatTurn;
  const { session } = chatTurn.data;
  const checkpoint = findTurnCheckpoint(args.workItemId, args.turnId);
  if (!checkpoint) {
    return refuseHistory('no_checkpoint', 'No checkpoint was saved after this turn.');
  }
  // The source lane's path is where its conversation is kept, whether or not
  // its checkout is still there.
  const point = resolveHistoryPoint(
    chatTurn.data,
    laneSessionCwd(resolveSessionWorktreeRow(session.id))
  );
  if (!point.success) return point;

  const created = await createWorktree({
    workItemId: args.workItemId,
    title: 'fork',
    fromCheckpoint: checkpoint.commitSha,
  });
  if (!created.success) {
    return refuseHistory('lane_not_created', describeCreateError(created.error));
  }
  const lane = created.data;
  const lanePath = resolve(lane.path);
  const laneCwd = laneSessionCwd(lane);

  let fork: ForkedConversation;
  try {
    fork = await forkConversationAtTurn(point.data, { into: laneCwd });
  } catch (error) {
    const removed = await deleteWorktree(lane.id);
    if (!removed.success) {
      log.error('[chat-history] could not delete the lane of a failed fork', {
        worktreeId: lane.id,
        error: removed.error,
      });
    }
    throw error;
  }
  const sessionId = await createForkedChat({
    chatTurn: chatTurn.data,
    fork,
    lane: { id: lane.id, path: lanePath, cwd: laneCwd },
    checkpointLane: { worktreeId: lane.id, branchName: lane.branchName },
  });
  log.info('[chat-history] forked to new worktree', {
    workItemId: args.workItemId,
    from: session.id,
    to: sessionId,
    turnId: args.turnId,
    worktreeId: lane.id,
  });
  return ok({ sessionId, worktreeId: lane.id });
}
