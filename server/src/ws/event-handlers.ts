import type {
  ChatMessageAckServerEvent,
  ChatMessageEvent,
  PresenceUpdateEvent,
  TypingIndicatorEvent,
} from '@chord/protocol';
import { sql } from 'drizzle-orm';
import { deliverHumanMessage, insertHumanMessage } from '../chat-messages/post-human-message.js';
import { db } from '../db/client.js';
import { presence } from '../db/schema-sharing.js';
import { authorizeWorkItemEvent, authorizeWorkItemWrite, workItemRoomId } from './authorize.js';
import type { AuthenticatedWebSocket, ConnectionManager } from './connection-manager.js';
import { createKeyedSerializer } from './keyed-serializer.js';

function sendAccessDenied(ws: AuthenticatedWebSocket, eventType: string): void {
  ws.send(JSON.stringify({ type: 'error', payload: `Access denied: ${eventType}` }));
}

function sendChatAck(
  ws: AuthenticatedWebSocket,
  payload: ChatMessageAckServerEvent['payload']
): void {
  const ack: ChatMessageAckServerEvent = { type: 'chat_message_ack', payload };
  ws.send(JSON.stringify(ack));
}

export async function handleChatMessage(
  ws: AuthenticatedWebSocket,
  event: ChatMessageEvent,
  manager: ConnectionManager
): Promise<void> {
  const { work_item_id } = event.payload;

  if (!(await authorizeWorkItemWrite(ws, work_item_id))) {
    sendAccessDenied(ws, 'chat_message');
    return;
  }

  const result = await insertHumanMessage(ws.user, event.payload);
  if (result.kind === 'unknown_session') {
    ws.send(
      JSON.stringify({ type: 'error', payload: 'chat_message: unknown session for work item' })
    );
    return;
  }
  if (result.kind === 'id_conflict') {
    ws.send(JSON.stringify({ type: 'error', payload: 'chat_message: id conflict' }));
    return;
  }

  const ack = {
    id: result.message.id,
    work_item_id,
    created_at: result.message.created_at.toISOString(),
  };
  if (result.kind === 'replayed') {
    sendChatAck(ws, ack);
    return;
  }

  // Auto-join sender to the work item room for ongoing relay
  const roomId = workItemRoomId(work_item_id);
  if (!ws.rooms.has(roomId)) {
    manager.joinRoom(ws, roomId);
  }
  // The room broadcast excludes the sender — the ack is their only frame
  // carrying the canonical {id, created_at}.
  sendChatAck(ws, ack);
  await deliverHumanMessage(manager, result.message, ws);
}

// One (user, work item) at a time, in the order sent (devstation-5ek). The
// socket's handlers are not awaited (server.ts), and a quick "nothing
// focused" then "in the chat" used to race: the older row could commit last
// and stay, so anyone seeding from it read a stale presence. Handlers run in
// order per key; writes are chained in that order without holding back the
// next broadcast.
const presenceInOrder = createKeyedSerializer();
const presenceWritesInOrder = createKeyedSerializer();

export function handlePresenceUpdate(
  ws: AuthenticatedWebSocket,
  event: PresenceUpdateEvent,
  manager: ConnectionManager
): Promise<void> {
  const key = `${ws.user.userId}:${event.payload.work_item_id ?? ''}`;
  return presenceInOrder(key, () => applyPresenceUpdate(ws, event, manager, key));
}

async function applyPresenceUpdate(
  ws: AuthenticatedWebSocket,
  event: PresenceUpdateEvent,
  manager: ConnectionManager,
  key: string
): Promise<void> {
  const { work_item_id, status, cursor_position, active_view } = event.payload;

  if (work_item_id && !(await authorizeWorkItemEvent(ws, work_item_id))) {
    sendAccessDenied(ws, 'presence_update');
    return;
  }

  // Presence is ephemeral: broadcast first, persist without waiting. The
  // neon-http driver costs a full HTTPS round trip per query, which must not
  // sit on the latency path of every presence/cursor tick; the writes still
  // go one at a time per key, so the last update sent is the row that stays.
  if (work_item_id) {
    manager.trackCursorWrite(ws, work_item_id, !!cursor_position);
    const roomId = `work_item:${work_item_id}`;
    manager.broadcastToRoom(
      roomId,
      {
        type: 'presence_changed',
        payload: {
          user_id: ws.user.userId,
          work_item_id,
          status,
          cursor_position: cursor_position ?? null,
          active_view: active_view ?? null,
          last_seen: new Date().toISOString(),
        },
      },
      ws
    );
  }

  const set = {
    status,
    cursor_position: cursor_position ?? null,
    active_view: active_view ?? null,
    last_seen: new Date(),
  };
  void presenceWritesInOrder(key, async () => {
    await db
      .insert(presence)
      .values({ user_id: ws.user.userId, work_item_id, ...set })
      .onConflictDoUpdate(
        // Each arbiter must name one of the two partial unique indexes on
        // presence: per-work-item rows vs the single NULL row per user.
        work_item_id
          ? {
              target: [presence.user_id, presence.work_item_id],
              targetWhere: sql`${presence.work_item_id} is not null`,
              set,
            }
          : {
              target: presence.user_id,
              targetWhere: sql`${presence.work_item_id} is null`,
              set,
            }
      );
  }).catch((err: Error) => {
    console.error('[ws] presence persist failed:', err.message);
  });
}

export async function handleTypingIndicator(
  ws: AuthenticatedWebSocket,
  event: TypingIndicatorEvent,
  manager: ConnectionManager
): Promise<void> {
  const { work_item_id, is_typing } = event.payload;

  if (!(await authorizeWorkItemEvent(ws, work_item_id))) {
    sendAccessDenied(ws, 'typing_indicator');
    return;
  }

  const roomId = `work_item:${work_item_id}`;

  manager.broadcastToRoom(
    roomId,
    {
      type: 'typing_indicator_changed',
      payload: {
        user_id: ws.user.userId,
        email: ws.user.email,
        work_item_id,
        is_typing,
      },
    },
    ws
  );
}
