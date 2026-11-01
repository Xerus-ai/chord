import { eq } from 'drizzle-orm';
import { err, ok } from '@shared/result';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';
import { insertChatMessageRow } from './insert-chat-message-row';
import { validateTargetSession } from './validate-target-session';

/**
 * Saves a message the sender addressed to people, not to the agent: it lands
 * in its thread and syncs like any message, and starts no agent turn. The
 * agent reads it as conversation context in the thread digest on its next
 * turn, as it reads a teammate's (use-cloud-thread-composer.ts).
 *
 * It used to wake the agent with a note that the message was not for it, and
 * the agent dutifully answered "Not addressed to me — no action." under every
 * one (user report, 2026-10-02).
 */
export async function postMessageToThread(args: {
  workItemId: string;
  sessionId: string;
  content: string;
  senderName?: string;
}) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, args.sessionId))
    .limit(1);
  const validated = validateTargetSession(row, args.workItemId);
  if (!validated.success) return err(validated.error);

  const { id } = await insertChatMessageRow({
    workItemId: args.workItemId,
    content: args.content,
    sessionId: args.sessionId,
    metadata: '{}',
    senderName: args.senderName,
  });
  return ok({ messageId: id });
}
