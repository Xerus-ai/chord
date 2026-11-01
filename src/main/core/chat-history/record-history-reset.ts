import { randomUUID } from 'node:crypto';
import { stampChatRowTime } from '@main/core/chat-messages/chat-row-time';
import { emitChatMessage } from '@main/core/chat-messages/emit-chat-message';
import { db } from '@main/db/client';
import { chatMessages } from '@main/db/schema-work-items';

/** The chat row kind a Reset leaves, read by the renderer to dim what the agent forgot. */
export const HISTORY_RESET_EVENT = 'history_reset';

/**
 * Posts the Reset into the chat as a system row. Nothing is deleted: the chat
 * is shared and the cloud has no delete, so this row (which syncs like any
 * message) is what tells everyone that the turns between `targetTurnId` and
 * here are no longer in the agent's memory.
 */
export async function recordHistoryReset(args: {
  workItemId: string;
  sessionId: string;
  targetTurnId: string;
  agentName: string;
}): Promise<string> {
  const id = randomUUID();
  const time = stampChatRowTime();
  const content = `Reset to an earlier turn. The files are back to how they were after it, and ${args.agentName} no longer remembers what came after it.`;
  const metadata = JSON.stringify({ event: HISTORY_RESET_EVENT, targetTurnId: args.targetTurnId });

  await db.insert(chatMessages).values({
    id,
    workItemId: args.workItemId,
    sessionId: args.sessionId,
    senderType: 'system',
    senderId: null,
    senderName: 'Chord',
    content,
    messageType: 'system',
    metadata,
    ...time,
  });
  emitChatMessage(
    id,
    args.workItemId,
    args.sessionId,
    'system',
    null,
    'Chord',
    content,
    'system',
    metadata,
    time
  );
  return id;
}
