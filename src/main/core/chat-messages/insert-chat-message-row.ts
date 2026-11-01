import { randomUUID } from 'node:crypto';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { db } from '@main/db/client';
import { chatMessages } from '@main/db/schema-work-items';
import { stampChatRowTime } from './chat-row-time';
import { emitChatMessage } from './emit-chat-message';

/**
 * The one write path for a locally-composed human chat row: durable insert,
 * renderer broadcast, and cloud sync-queue upload (the last two via
 * `emitChatMessage`).
 *
 * Shared by `sendMessageToAgent` and `sendMessageToRoom` — the two entry
 * points differ only in what happens AFTER the row exists (a prompt into the
 * agent session, or nothing at all), so the row itself must not be written
 * twice in two places.
 */
export async function insertChatMessageRow(args: {
  workItemId: string;
  content: string;
  /** The live chat session this row belongs to, when there is one. */
  sessionId: string | null;
  /** Serialized row metadata — `{}` for ordinary room chat. */
  metadata: string;
  senderName?: string;
}): Promise<{ id: string; createdAt: number }> {
  const id = randomUUID();
  const time = stampChatRowTime();
  // Identity comes from the signed-in account, never from the caller alone:
  // sender_id is what lets every device tell "mine" from "teammate's".
  const account = await chordAccountService.getSession();
  const senderId = account.user?.userId ?? null;
  const senderName = args.senderName ?? account.user?.username ?? 'User';

  await db.insert(chatMessages).values({
    id,
    workItemId: args.workItemId,
    sessionId: args.sessionId,
    senderType: 'human',
    senderId,
    senderName,
    content: args.content,
    messageType: 'text',
    metadata: args.metadata,
    ...time,
  });

  emitChatMessage(
    id,
    args.workItemId,
    args.sessionId,
    'human',
    senderId,
    senderName,
    args.content,
    'text',
    args.metadata,
    time
  );

  return { id, createdAt: time.createdAt };
}
