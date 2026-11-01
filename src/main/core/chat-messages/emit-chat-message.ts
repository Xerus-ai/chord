import type { CloudChatBulkMessage } from '@chord/protocol';
import { chatMessageChannel, type ChatMessageEvent } from '@shared/events/chatEvents';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { events } from '@main/lib/events';
import type { ChatRowTime } from './chat-row-time';
import { toCloudChatBulkMessage } from './chat-wire-mapper';

/**
 * Broadcasts a durable chat row to the renderer and hands it to the cloud
 * history push. Every write path that inserts into `chat_messages` goes
 * through here, so no row can reach the DB without reaching both.
 */
export function emitChatMessage(
  id: string,
  workItemId: string,
  sessionId: string | null,
  senderType: string,
  senderId: string | null,
  senderName: string,
  content: string,
  messageType: string,
  metadata: string,
  time: ChatRowTime
) {
  emitChatMessages(workItemId, [
    {
      id,
      workItemId,
      sessionId,
      senderType,
      senderId,
      senderName,
      content,
      messageType,
      metadata,
      ...time,
    },
  ]);
}

/** Several rows of one work item at once (a forked thread's copy): one cloud enqueue. */
export function emitChatMessages(workItemId: string, rows: readonly ChatMessageEvent[]): void {
  const wires: CloudChatBulkMessage[] = [];
  for (const row of rows) {
    events.emit(chatMessageChannel, row, workItemId);
    const wire = toCloudChatBulkMessage(row);
    if (wire) wires.push(wire);
  }
  if (wires.length > 0) syncQueueService.enqueueChatMessages(workItemId, wires);
}
