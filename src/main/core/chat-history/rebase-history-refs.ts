import { and, eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { chatMessages } from '@main/db/schema-work-items';

/**
 * Points a chat's turns at the conversation it now resumes: after a Reset,
 * every turn up to the target is in the fork under the ref `mapRef` gives
 * (a Claude fork renames its entries), and every later turn is in no
 * conversation the chat has, so its ref is cleared. Turns are ordered by
 * arrival (rowid), as the chat itself is.
 */
export function rebaseSessionHistoryRefs(
  sessionId: string,
  targetTurnId: string,
  mapRef: (sourceRef: string) => string | null
): void {
  const rows = db
    .select({
      id: chatMessages.id,
      turnId: chatMessages.turnId,
      historyRef: chatMessages.historyRef,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.messageType, 'agent_turn')))
    .orderBy(sql`rowid`)
    .all();
  const targetIndex = rows.findIndex((row) => row.turnId === targetTurnId);
  if (targetIndex === -1) {
    throw new Error(
      `rebaseSessionHistoryRefs: turn ${targetTurnId} is not in session ${sessionId}`
    );
  }

  db.transaction((tx) => {
    rows.forEach((row, index) => {
      const next = index <= targetIndex && row.historyRef !== null ? mapRef(row.historyRef) : null;
      if (next === row.historyRef) return;
      tx.update(chatMessages).set({ historyRef: next }).where(eq(chatMessages.id, row.id)).run();
    });
  });
}
