import type {
  CloudChatBulkMessage,
  CloudChatMessageType,
  CloudChatSenderType,
} from '@chord/protocol';
import { log } from '@main/lib/logger';

// Owner-side per-message budget. A row serializing beyond this is pushed with
// its metadata replaced by a content_omitted marker — never silently dropped,
// and never left to a server 413 that would poison the whole chunk.
const PER_MESSAGE_BYTE_BUDGET = 256 * 1024;

const WIRE_SENDER_TYPES: ReadonlySet<string> = new Set(['human', 'agent', 'system']);
const WIRE_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'code',
  'system',
  'commit',
  'agent_turn',
]);

export interface LocalChatMessageShape {
  id: string;
  workItemId: string;
  sessionId: string | null;
  senderType: string;
  senderName: string | null;
  content: string;
  messageType: string;
  metadata: string | null;
  /** Local rows store epoch SECONDS... */
  createdAt: number;
  /** ...and the same moment to the millisecond, which is what the cloud keeps. */
  createdAtMs: number;
}

/**
 * Maps a local chat_messages row to the bulk-push wire shape. Returns null
 * (with a loud log) for rows outside the wire enums — one unexpected legacy
 * row must not 400 an entire backfill chunk forever.
 */
export function toCloudChatBulkMessage(row: LocalChatMessageShape): CloudChatBulkMessage | null {
  if (!WIRE_SENDER_TYPES.has(row.senderType) || !WIRE_MESSAGE_TYPES.has(row.messageType)) {
    log.warn('[chat-sync] row outside wire enums, not pushed', {
      id: row.id,
      senderType: row.senderType,
      messageType: row.messageType,
    });
    return null;
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(row.metadata ?? '{}') as Record<string, unknown>;
  } catch {
    log.warn('[chat-sync] malformed metadata JSON, pushing without it', { id: row.id });
    metadata = {};
  }

  const message: CloudChatBulkMessage = {
    id: row.id,
    content: row.content,
    session_id: row.sessionId,
    sender_type: row.senderType as CloudChatSenderType,
    sender_name: row.senderName,
    message_type: row.messageType as CloudChatMessageType,
    created_at: new Date(row.createdAtMs).toISOString(),
    metadata,
  };

  if (JSON.stringify(message).length > PER_MESSAGE_BYTE_BUDGET) {
    log.warn('[chat-sync] oversized message pushed with content omitted', { id: row.id });
    return { ...message, content: '', metadata: { content_omitted: true } };
  }

  return message;
}
