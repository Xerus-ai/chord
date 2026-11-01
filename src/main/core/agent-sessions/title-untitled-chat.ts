import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';

/** As long as a title a first send gives a chat it mints (`deliver-to-session.ts`). */
const TITLE_LENGTH = 120;

/**
 * Titles a titleless chat from the first message it receives, as a chat
 * started by a first send is titled. A chat opened from the + menu has no
 * title, so every surface named it after its agent and two Codex chats in one
 * lane both read "Codex" (devstation-d8lx). A chat with a title, a terminal,
 * and a blank message are left alone. Returns whether it titled the chat; the
 * caller announces the change.
 */
export async function titleUntitledChat(sessionId: string, message: string): Promise<boolean> {
  const [row] = await db
    .select({ kind: agentSessions.kind, title: agentSessions.title })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);
  if (!row) throw new Error(`No agent session ${sessionId} to title`);
  const title = message.trim().slice(0, TITLE_LENGTH);
  if (row.kind !== 'chat' || row.title !== null || title === '') return false;
  await db
    .update(agentSessions)
    .set({ title })
    .where(and(eq(agentSessions.id, sessionId), isNull(agentSessions.title)));
  return true;
}
