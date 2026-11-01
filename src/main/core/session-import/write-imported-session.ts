import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getAgentDisplayName } from '@shared/agent-display-name';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { chatMessageChannel, type ChatMessageEvent } from '@shared/events/chatEvents';
import { err, ok, type Result } from '@shared/result';
import type { SessionImportError } from '@shared/session-import';
import { stampChatRowTime } from '@main/core/chat-messages/chat-row-time';
import {
  toCloudChatBulkMessage,
  type LocalChatMessageShape,
} from '@main/core/chat-messages/chat-wire-mapper';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { agentSessions, chatMessages } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import type { ImportedMessage } from './transcript-builder';

export interface ImportedSessionWrite {
  workItemId: string;
  worktreeId: string;
  cwd: string;
  providerId: AgentProviderId;
  providerSessionId: string;
  title: string | null;
  /** ms epoch */
  lastActivityAt: number | null;
  /** Who typed the prompts: the signed-in user of this machine. */
  sender: { id: string | null; name: string };
  messages: ImportedMessage[];
}

const toSeconds = (ms: number) => Math.floor(ms / 1000);

/**
 * Prompts were delivered to this agent when they were typed: `agent_prompt`
 * keeps them out of every later prompt's thread digest (`thread-digest.ts`).
 */
const DELIVERED_PROMPT_METADATA = JSON.stringify({ agent_prompt: true });

function toRow(
  message: ImportedMessage,
  args: ImportedSessionWrite,
  sessionId: string
): LocalChatMessageShape & { senderId: string | null; turnId: string | null; metadata: string } {
  const id = randomUUID();
  if (message.kind === 'human') {
    return {
      id,
      workItemId: args.workItemId,
      sessionId,
      senderType: 'human',
      senderId: args.sender.id,
      senderName: args.sender.name,
      content: message.content,
      messageType: 'text',
      metadata: DELIVERED_PROMPT_METADATA,
      turnId: null,
      ...stampChatRowTime(message.createdAt),
    };
  }
  const turnId = randomUUID();
  return {
    id,
    workItemId: args.workItemId,
    sessionId,
    senderType: 'agent',
    senderId: null,
    senderName: getAgentDisplayName(args.providerId),
    content: '',
    messageType: 'agent_turn',
    // The shape `persistCompletedTurn` writes.
    metadata: JSON.stringify({
      turnId,
      items: message.items,
      startedAt: message.startedAt,
      completedAt: message.completedAt,
    }),
    turnId,
    ...stampChatRowTime(message.completedAt),
  };
}

/**
 * The imported session and its history in one transaction: the chat row that
 * holds the provider's session id and every earlier message, or nothing.
 * Whether Chord already holds the session is decided inside it, so two imports
 * of one session cannot both land. Once committed, the messages are queued for
 * the cloud like any work-item chat.
 */
export function writeImportedSession(
  args: ImportedSessionWrite
): Result<{ sessionId: string; messageCount: number }, SessionImportError> {
  const sessionId = randomUUID();
  const rows = args.messages.map((message) => toRow(message, args, sessionId));
  const now = Math.floor(Date.now() / 1000);

  let held: { sessionId: string; workItemId: string } | null;
  try {
    held = db.transaction((tx) => {
      const [holder] = tx
        .select({ sessionId: agentSessions.id, workItemId: agentSessions.workItemId })
        .from(agentSessions)
        .where(eq(agentSessions.externalSessionId, args.providerSessionId))
        .limit(1)
        .all();
      if (holder) return holder;
      tx.insert(agentSessions)
        .values({
          id: sessionId,
          workItemId: args.workItemId,
          kind: 'chat',
          agentProviderId: args.providerId,
          // What session-service records for claude-sdk, codex and ACP chats.
          communication: 'acp',
          externalSessionId: args.providerSessionId,
          title: args.title,
          cwd: args.cwd,
          worktreeId: args.worktreeId,
          status: 'suspended',
          provisionStatus: 'ready',
          createdAt: now,
          lastActiveAt: args.lastActivityAt !== null ? toSeconds(args.lastActivityAt) : now,
        })
        .run();
      for (const row of rows) tx.insert(chatMessages).values(row).run();
      return null;
    });
  } catch (error) {
    return err({
      type: 'write_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (held) return err({ type: 'already_imported', ...held });

  // An open work item seeds its turns once, at mount, and from then on learns
  // of a finished turn only from this event (`use-chat-messages.ts`), as it
  // does from `persistCompletedTurn`. Without it an imported reply stays off
  // screen until the item is reopened.
  for (const row of rows) {
    const event: ChatMessageEvent = {
      id: row.id,
      workItemId: row.workItemId,
      sessionId: row.sessionId,
      senderType: row.senderType,
      senderId: row.senderId,
      senderName: row.senderName,
      content: row.content,
      messageType: row.messageType,
      metadata: row.metadata,
      createdAt: row.createdAt,
      createdAtMs: row.createdAtMs,
    };
    events.emit(chatMessageChannel, event, args.workItemId);
  }

  const wire = rows.flatMap((row) => {
    const message = toCloudChatBulkMessage(row);
    return message ? [message] : [];
  });
  syncQueueService.enqueueChatMessages(args.workItemId, wire);
  return ok({ sessionId, messageCount: rows.length });
}
