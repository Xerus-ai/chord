import { randomUUID } from 'node:crypto';
import type { ChatMessageEvent, ChatMessageReceivedServerEvent } from '@chord/protocol';
import { and, eq } from 'drizzle-orm';
import { listWorkItemPrincipals } from '../access/work-item-audience.js';
import { db } from '../db/client.js';
import { chatMessages, workItemSessions } from '../db/schema.js';
import { insertNotifications } from '../notifications/insert-notifications.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { AuthenticatedWebSocket, ConnectionManager } from '../ws/connection-manager.js';

/**
 * The one write path for a message a person sends, whether it arrives as the
 * socket's chat_message or as REST POST /work-items/:id/messages
 * (devstation-3iw: the REST route used to insert and stop, reaching nobody).
 * Split in two because the socket acks its sender between the insert and the
 * delivery.
 */

type ChatMessageRow = typeof chatMessages.$inferSelect;

/** A row this path just stored, typed as what was written: a person's id and a metadata object. */
export type HumanMessageRow = Omit<ChatMessageRow, 'sender_id' | 'metadata'> & {
  sender_id: string;
  metadata: Record<string, unknown>;
};

export interface HumanMessageSender {
  userId: string;
  email: string;
}

export type InsertHumanMessageResult =
  /** Stored now; deliver it. */
  | { kind: 'created'; message: HumanMessageRow }
  /** The sender's retry of a stored id: echo it, deliver nothing. */
  | { kind: 'replayed'; message: ChatMessageRow }
  | { kind: 'unknown_session' }
  /** The id is taken by another sender or another work item. */
  | { kind: 'id_conflict' };

export async function insertHumanMessage(
  sender: HumanMessageSender,
  input: ChatMessageEvent['payload']
): Promise<InsertHumanMessageResult> {
  const { work_item_id, session_id } = input;

  // A named thread must be a thread OF THIS WORK ITEM. Refused, not quietly
  // redirected: the sender addressed one agent's conversation, and putting
  // their words in front of a different agent is a wrong answer, not a
  // lenient one — the same rule the command channel adopted in 70a67b8 after
  // the Room's bare @claude proved untrustworthy for exactly this reason.
  // A client that names no thread still stores null and renders as work-item
  // history in every thread, so older clients are unaffected.
  if (session_id != null) {
    const [session] = await db
      .select({ id: workItemSessions.id })
      .from(workItemSessions)
      .where(
        and(eq(workItemSessions.id, session_id), eq(workItemSessions.work_item_id, work_item_id))
      )
      .limit(1);
    if (!session) return { kind: 'unknown_session' };
  }

  const id = input.id ?? randomUUID();
  const metadata = input.metadata ?? {};
  const [inserted] = await db
    .insert(chatMessages)
    .values({
      id,
      work_item_id,
      session_id: session_id ?? null,
      sender_id: sender.userId,
      sender_type: 'human',
      sender_name: sender.email,
      content: input.content,
      message_type: input.message_type,
      metadata,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    return { kind: 'created', message: { ...inserted, sender_id: sender.userId, metadata } };
  }

  // The id already exists. A retry by the original sender in the same work
  // item gets the STORED row; anything else is rejected. Nothing is ever
  // delivered on a conflict — resent content that was not persisted must not
  // be able to rewrite messages in live views.
  const [existing] = await db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1);
  if (!existing || existing.work_item_id !== work_item_id || existing.sender_id !== sender.userId) {
    return { kind: 'id_conflict' };
  }
  return { kind: 'replayed', message: existing };
}

/**
 * Sends a newly stored message to the room (except `senderSocket`, which the
 * socket path acks instead), relays it to principals not in the room, and
 * notifies the offline ones.
 */
export async function deliverHumanMessage(
  manager: ConnectionManager,
  message: HumanMessageRow,
  senderSocket?: AuthenticatedWebSocket
): Promise<void> {
  const { work_item_id, sender_id } = message;
  const roomId = workItemRoomId(work_item_id);

  const received: ChatMessageReceivedServerEvent = {
    type: 'chat_message_received',
    payload: {
      id: message.id,
      work_item_id,
      // The thread this was typed into, validated at insert. Null only for a
      // client that named none (pre-registry rows are history in every
      // thread).
      session_id: message.session_id,
      sender_id,
      sender_type: 'human',
      sender_name: message.sender_name,
      content: message.content,
      message_type: message.message_type,
      metadata: message.metadata,
      created_at: message.created_at.toISOString(),
    },
  };
  manager.broadcastToRoom(roomId, received, senderSocket);

  const principals = await listWorkItemPrincipals(work_item_id);
  const roomMemberIds = new Set(manager.getRoomMembers(roomId).map((m) => m.userId));
  for (const userId of principals) {
    if (userId !== sender_id && !roomMemberIds.has(userId)) {
      manager.broadcastToUser(userId, received);
    }
  }

  // One multi-row insert instead of N sequential round trips (neon-http pays
  // a full HTTPS round trip per query, so a busy work item paid that once per
  // offline reader).
  await insertNotifications(
    manager,
    principals
      .filter((userId) => userId !== sender_id && !manager.isUserOnline(userId))
      .map((userId) => ({
        user_id: userId,
        type: 'new_message' as const,
        actor_user_id: sender_id,
        work_item_id,
        message_id: message.id,
        excerpt: message.content,
      }))
  );
}
