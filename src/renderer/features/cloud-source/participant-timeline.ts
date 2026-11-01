import type { CloudChatMessage } from '@chord/protocol';
import type { AgentTurn } from '@shared/stream-items';
import { dbRowToChatEntry } from '@renderer/features/work-list/chat-message-transform';
import type { ThreadRow, TranscriptItem } from '@renderer/features/work-list/transcript-rows';

export function epochSecondsOf(message: CloudChatMessage): number {
  return Math.floor(Date.parse(message.created_at) / 1000);
}

// Cloud rows are snake_case with ISO timestamps and object metadata; the
// shared transform consumes the local row shape (string metadata, epoch
// seconds and milliseconds). Adapt — never fork the transform itself.
function cloudRowToLocalShape(message: CloudChatMessage) {
  return {
    id: message.id,
    workItemId: message.work_item_id,
    sessionId: message.session_id,
    senderType: message.sender_type,
    senderId: message.sender_id,
    senderName: message.sender_name,
    content: message.content,
    messageType: message.message_type,
    metadata: JSON.stringify(message.metadata ?? {}),
    createdAt: epochSecondsOf(message),
    createdAtMs: Date.parse(message.created_at),
  };
}

interface CloudChatMetadata {
  turnId?: string;
  items?: AgentTurn['items'];
  /** When the turn began, epoch ms (`persistCompletedTurn`). */
  startedAt?: number;
  truncated?: boolean;
  agent_prompt?: boolean;
  command_id?: string;
}

// The wire type says metadata is always an object, but a malformed row
// (bad backfill, hand-edited DB row) can still carry a JSON null — guard
// every read through this instead of trusting the static type, or one bad
// row throws and blanks the whole participant view.
export function metadataOf(message: CloudChatMessage): CloudChatMetadata {
  return (message.metadata ?? {}) as CloudChatMetadata;
}

// agent_turn rows must NEVER go through dbRowToChatEntry — it maps them to an
// empty system event and they render blank. Reconstruct the turn from
// metadata exactly like the owner's timeline does.
function toAgentTurn(message: CloudChatMessage): AgentTurn | null {
  const meta = metadataOf(message);
  // The list endpoint replaces oversized metadata with a { truncated } marker
  // (see server/src/routes/messages.ts trimForList) — items isn't there yet.
  // The item's CloudChatProvider hydrates the full row; this build
  // just skips the turn until that merge lands.
  if (meta.truncated || !meta.turnId || !meta.items) return null;
  return {
    id: meta.turnId,
    workItemId: message.work_item_id,
    agentName: message.sender_name ?? 'Agent',
    items: meta.items,
    status: 'complete',
    timestamp: epochSecondsOf(message),
    startedAt: meta.startedAt,
  };
}

/** A row of the feed, with the session it was written in (null: none). */
interface SessionedItem {
  item: ThreadRow;
  sessionId: string | null;
}

/**
 * Which session a row reads as belonging to. Rows written over the live
 * participant socket carry `session_id: null` (the server's handleChatMessage
 * stamps it null — there is no agent session behind a human's ambient
 * message), so a null row inherits the session that was running when it was
 * posted. Grouping strictly by the column instead would tear every
 * conversation into alternating "session" and "no session" blocks.
 */
function resolveSessions(items: SessionedItem[]): (string | null)[] {
  let carried: string | null = null;
  return items.map(({ sessionId }) => {
    if (sessionId !== null) carried = sessionId;
    return carried;
  });
}

/**
 * A teammate's transcript rows, for the shared `TranscriptList`: agent turns,
 * human messages, and system events in time order, with a divider wherever
 * the stream crosses from one agent session into the next.
 *
 * A chat tab's rows are one session plus session-less history, so it never
 * gets a divider and reads exactly like the owner's. Only the item chat (no
 * chats published yet, every row shown) can mix sessions; without dividers,
 * two unrelated agent runs would read as one confusing conversation.
 */
export function buildCloudTranscript(messages: CloudChatMessage[]): TranscriptItem[] {
  const turns: SessionedItem[] = [];
  const entries: SessionedItem[] = [];

  for (const message of messages) {
    if (message.message_type === 'agent_turn') {
      const turn = toAgentTurn(message);
      if (turn && turn.items.length > 0) {
        // Where it started, as on the owner's side (`buildSessionTranscript`).
        turns.push({
          item: { sort: turn.startedAt ?? Date.parse(message.created_at), type: 'turn', turn },
          sessionId: message.session_id,
        });
      }
      continue;
    }
    const entry = dbRowToChatEntry(cloudRowToLocalShape(message));
    entries.push({
      item: {
        sort: Date.parse(message.created_at),
        type: 'message',
        entry,
        commandId: metadataOf(message).command_id,
      },
      sessionId: message.session_id,
    });
  }

  // pty-era histories persisted agent replies as plain chat rows and have no
  // turns at all; only then are those rows rendered, or every modern feed
  // would show each agent reply twice.
  const isAgentRow = ({ item }: SessionedItem) =>
    item.type === 'message' && item.entry.kind === 'message' && item.entry.sender === 'agent';
  const showLegacy = turns.length === 0 && entries.some(isAgentRow);

  const items: SessionedItem[] = entries.filter(({ item }) => {
    if (item.type !== 'message') return false;
    if (item.entry.kind === 'system-event' && !item.entry.message) return false;
    return showLegacy || !isAgentRow({ item, sessionId: null });
  });
  items.push(...turns);
  items.sort((a, b) => a.item.sort - b.item.sort);

  const resolved = resolveSessions(items);
  const distinct = new Set(resolved.filter((id): id is string => id !== null));
  if (distinct.size < 2) return items.map(({ item }) => item);

  const ordinals = new Map<string, number>();
  const rows: TranscriptItem[] = [];
  let previous: string | null = null;
  items.forEach(({ item }, i) => {
    const sessionId = resolved[i];
    if (sessionId !== null && sessionId !== previous) {
      let ordinal = ordinals.get(sessionId);
      if (ordinal === undefined) {
        ordinal = ordinals.size + 1;
        ordinals.set(sessionId, ordinal);
      }
      const rowKey = item.type === 'turn' ? item.turn.id : item.entry.id;
      rows.push({
        sort: item.sort,
        type: 'divider',
        key: `divider:${sessionId}:${rowKey}`,
        ordinal,
        startedAt: Math.floor(item.sort / 1000),
      });
    }
    previous = sessionId;
    rows.push(item);
  });
  return rows;
}
