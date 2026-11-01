import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { chatMessages } from '@main/db/schema-work-items';

/**
 * Ties a message to the chat session it was delivered to. A message saved
 * before any chat session existed — a work item's first prompt, or one held
 * until setup succeeds — is stored with no session, which reads as room chat:
 * every chat of the item showed it (`controller.ts` getTimelineTurns) and the
 * rail counted it against none (devstation-w50w). A message that already
 * belongs to a session is never moved.
 */
export async function attributeMessageToSession(
  messageId: string,
  sessionId: string
): Promise<void> {
  const [row] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  if (!row) throw new Error(`No chat message ${messageId} to attribute to session ${sessionId}`);
  await db
    .update(chatMessages)
    .set({ sessionId })
    .where(and(eq(chatMessages.id, messageId), isNull(chatMessages.sessionId)));
}
