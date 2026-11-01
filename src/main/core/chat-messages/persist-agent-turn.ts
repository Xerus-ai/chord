import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { chatMessageChannel, type ChatMessageEvent } from '@shared/events/chatEvents';
import type { AgentTurn } from '@shared/stream-items';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { agentSessions, chatMessages } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { stampChatRowTime } from './chat-row-time';
import { toCloudChatBulkMessage } from './chat-wire-mapper';

/** `agent_sessions.last_turn_status` value written when a turn ends in error. */
const TURN_ERROR_STATUS = 'error';

/**
 * Records whether a session's most recently completed turn ended in error —
 * the durable `lastTurnErrored` source for sidebar-worktree-summaries.ts.
 * Cleared (set back to null) by the next turn that completes without error,
 * so an errored session that goes on to finish cleanly stops being flagged.
 * Deliberately not the session's lifecycle `status` column: that tracks
 * active/suspended/done, which a resume or a new message flips independently
 * of whether the last turn actually succeeded.
 */
export function recordSessionTurnOutcome(sessionId: string | null, errored: boolean): void {
  if (!sessionId) return;
  const now = Math.floor(Date.now() / 1000);
  db.update(agentSessions)
    .set({ lastTurnStatus: errored ? TURN_ERROR_STATUS : null, lastTurnStatusAt: now })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

/**
 * A completed turn's durable record: one `agent_turn` chat message carrying the
 * whole item list as metadata, mirrored to the renderer and to the cloud.
 */
export function persistCompletedTurn(
  workItemId: string,
  turn: AgentTurn,
  sessionId: string | null
): void {
  const id = randomUUID();
  const time = stampChatRowTime();
  const metadata = JSON.stringify({
    turnId: turn.id,
    items: turn.items,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    usage: turn.usage,
  });

  try {
    db.insert(chatMessages)
      .values({
        id,
        workItemId,
        sessionId,
        senderType: 'agent',
        senderName: turn.agentName,
        content: '',
        messageType: 'agent_turn',
        metadata,
        turnId: turn.id,
        // Its own column, not metadata: metadata syncs, and a history ref
        // only means something to the agent's files on this device.
        historyRef: turn.historyRef ?? null,
        ...time,
      })
      .run();
  } catch (err) {
    log.warn('AgentEventBridge: failed to persist turn', { error: String(err) });
    return;
  }

  const chatEvent: ChatMessageEvent = {
    id,
    workItemId,
    sessionId,
    senderType: 'agent',
    senderId: null,
    senderName: turn.agentName,
    content: '',
    messageType: 'agent_turn',
    metadata,
    ...time,
    historyRef: turn.historyRef,
  };
  events.emit(chatMessageChannel, chatEvent, workItemId);

  // Feed the cloud history push — for participants this is the only live
  // delivery of agent output (turn-completion granularity).
  const wire = toCloudChatBulkMessage(chatEvent);
  if (wire) syncQueueService.enqueueChatMessages(workItemId, [wire]);
}
