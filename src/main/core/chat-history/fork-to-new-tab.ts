import { ok, type Result } from '@shared/result';
import { resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { log } from '@main/lib/logger';
import { createForkedChat } from './create-forked-chat';
import { forkConversationAtTurn } from './fork-conversation';
import {
  checkLanePresent,
  findChatTurn,
  resolveHistoryPoint,
  type HistoryRefusal,
} from './history-point';

/**
 * Fork to new tab (plan §"Decisions for Phase 5"): a new chat of the same
 * agent and model on the same lane, resuming the conversation forked at
 * `turnId`, with the thread up to that turn copied in under a "Forked from"
 * row. The source chat and the lane's files are untouched: the tab shares the
 * lane's checkout. Returns the new chat's id, for the renderer to open.
 */
export async function forkToNewTab(args: {
  workItemId: string;
  turnId: string;
}): Promise<Result<{ sessionId: string }, HistoryRefusal>> {
  const chatTurn = findChatTurn(args.workItemId, args.turnId);
  if (!chatTurn.success) return chatTurn;
  const { session } = chatTurn.data;
  const lane = checkLanePresent(resolveSessionWorktreeRow(session.id));
  if (!lane.success) return lane;
  const point = resolveHistoryPoint(chatTurn.data, lane.data.path);
  if (!point.success) return point;

  const fork = await forkConversationAtTurn(point.data);
  const sessionId = await createForkedChat({
    chatTurn: chatTurn.data,
    fork,
    lane: { id: lane.data.id, path: point.data.cwd },
  });
  log.info('[chat-history] forked to new tab', {
    workItemId: args.workItemId,
    from: session.id,
    to: sessionId,
    turnId: args.turnId,
  });
  return ok({ sessionId });
}
