import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { ChatMessageEvent } from '@shared/events/chatEvents';
import { requireCreatedAtMs } from '@main/core/chat-messages/chat-row-time';
import { emitChatMessages } from '@main/core/chat-messages/emit-chat-message';
import { db } from '@main/db/client';
import { agentThreadCursors } from '@main/db/schema-sync';
import { chatMessages } from '@main/db/schema-work-items';
import { HISTORY_RESET_EVENT } from './record-history-reset';

/** The chat row kind that heads a forked thread. */
export const FORKED_FROM_EVENT = 'forked_from';

type ChatMessageRow = typeof chatMessages.$inferSelect;

function parseMetadata(row: ChatMessageRow): Record<string, unknown> {
  return JSON.parse(row.metadata ?? '{}') as Record<string, unknown>;
}

/**
 * The source row as the new chat's own: a new id and session, a new turn id
 * for a turn (turn ids are unique across the work item's chats), its history
 * ref as the fork has it, and a reset marker pointing at the copied turn.
 */
function copyRow(
  row: ChatMessageRow,
  sessionId: string,
  turnIds: ReadonlyMap<string, string>,
  mapRef: (ref: string) => string | null
): ChatMessageRow {
  const metadata = parseMetadata(row);
  const turnId = row.turnId ? (turnIds.get(row.turnId) ?? null) : null;
  if (turnId) metadata.turnId = turnId;
  if (metadata.event === HISTORY_RESET_EVENT && typeof metadata.targetTurnId === 'string') {
    metadata.targetTurnId = turnIds.get(metadata.targetTurnId) ?? metadata.targetTurnId;
  }
  return {
    ...row,
    id: randomUUID(),
    sessionId,
    metadata: JSON.stringify(metadata),
    turnId,
    historyRef: row.historyRef ? mapRef(row.historyRef) : null,
    cloudId: null,
    syncedAt: null,
  };
}

function toEvent(row: ChatMessageRow): ChatMessageEvent {
  return {
    id: row.id,
    workItemId: row.workItemId,
    sessionId: row.sessionId,
    senderType: row.senderType,
    senderId: row.senderId,
    senderName: row.senderName,
    content: row.content,
    messageType: row.messageType,
    metadata: row.metadata ?? '{}',
    createdAt: row.createdAt,
    createdAtMs: requireCreatedAtMs(row),
    historyRef: row.historyRef ?? undefined,
  };
}

/**
 * Copies a chat's thread, up to and including `targetTurnId`, into the new
 * chat `sessionId` under a "Forked from" row, so the fork reads as one thread
 * and syncs as its own. Returns the copied turns' new ids by their source ids.
 * The new chat's digest starts after the copy: the agent already has these
 * messages in the forked conversation.
 */
export function copyThreadToSession(args: {
  workItemId: string;
  sourceSessionId: string;
  targetTurnId: string;
  sessionId: string;
  head: { content: string; metadata: Record<string, unknown> };
  mapRef: (ref: string) => string | null;
}): ReadonlyMap<string, string> {
  const source = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, args.sourceSessionId))
    .orderBy(sql`rowid`)
    .all();
  const targetIndex = source.findIndex(
    (row) => row.messageType === 'agent_turn' && row.turnId === args.targetTurnId
  );
  if (targetIndex === -1) {
    throw new Error(`copyThreadToSession: turn ${args.targetTurnId} is not in the source chat`);
  }
  const thread = source.slice(0, targetIndex + 1);

  const turnIds = new Map<string, string>();
  for (const row of thread) {
    if (row.messageType === 'agent_turn' && row.turnId) turnIds.set(row.turnId, randomUUID());
  }
  const head: ChatMessageRow = {
    ...thread[0],
    id: randomUUID(),
    sessionId: args.sessionId,
    senderType: 'system',
    senderId: null,
    senderName: 'Chord',
    content: args.head.content,
    messageType: 'system',
    metadata: JSON.stringify(args.head.metadata),
    turnId: null,
    historyRef: null,
    cloudId: null,
    syncedAt: null,
    // Just before the first copied row, so it heads the thread.
    createdAt: thread[0].createdAt - 1,
    createdAtMs: requireCreatedAtMs(thread[0]) - 1000,
  };
  const copies = [head, ...thread.map((row) => copyRow(row, args.sessionId, turnIds, args.mapRef))];

  db.transaction((tx) => {
    for (const row of copies) tx.insert(chatMessages).values(row).run();
    const [{ maxRowid }] = tx
      .select({ maxRowid: sql<number>`max(rowid)` })
      .from(chatMessages)
      .where(eq(chatMessages.workItemId, args.workItemId))
      .all();
    tx.insert(agentThreadCursors)
      .values({ sessionId: args.sessionId, lastRowid: maxRowid })
      .onConflictDoUpdate({ target: agentThreadCursors.sessionId, set: { lastRowid: maxRowid } })
      .run();
  });
  emitChatMessages(args.workItemId, copies.map(toEvent));
  return turnIds;
}
