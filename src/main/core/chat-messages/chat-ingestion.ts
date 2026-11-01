import type { CloudChatMessage } from '@chord/protocol';
import { eq } from 'drizzle-orm';
import { chatMessageChannel, type ChatMessageEvent } from '@shared/events/chatEvents';
import { db } from '@main/db/client';
import { chatMessages, workItems } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { stampChatRowTime } from './chat-row-time';
import { fetchCloudMessagesPage } from './cloud-chat-client';

// Reseed paging bounds. Pages walk BACKWARD from the newest cloud message
// until a page overlaps local history (every older row is then already
// local), so the cap only bites on a device that missed thousands of
// messages — log loudly when it does rather than truncating silently.
const RESEED_PAGE_SIZE = 200;
const RESEED_MAX_PAGES = 10;

/**
 * Cloud→local chat ingestion (design doc §4): writes a room chat frame (or a
 * reseed page row) into local chat_messages. Dedup is the id — own messages
 * echoed back, replayed frames, and reseed/live overlap are all no-ops.
 * Ingested rows are stamped synced_at AT INSERT so the outbound sync-queue
 * (which only enqueues synced_at IS NULL rows on backfill, and only rows the
 * local writer emits live) never pushes them back up — no echo loop.
 *
 * Deliberately NOT emitChatMessage (emit-chat-message.ts): that
 * helper is the local writer's path and enqueues a cloud push with every
 * emit. Ingestion emits the renderer event only.
 *
 * Returns true when a row was inserted, false on dedup/skip.
 */
export function ingestCloudChatMessage(msg: CloudChatMessage): boolean {
  const workItem = db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.id, msg.work_item_id))
    .get();
  if (!workItem) {
    // A frame can race a local delete; the row has no local home anymore.
    log.warn('[chat-ingest] dropping message for unknown work item', {
      id: msg.id,
      workItemId: msg.work_item_id,
    });
    return false;
  }

  const createdAtMs = Date.parse(msg.created_at);
  if (Number.isNaN(createdAtMs)) {
    throw new Error(`[chat-ingest] unparseable created_at on message ${msg.id}`);
  }
  const time = stampChatRowTime(createdAtMs);
  const metadata = JSON.stringify(msg.metadata ?? {});

  const result = db
    .insert(chatMessages)
    .values({
      id: msg.id,
      workItemId: msg.work_item_id,
      sessionId: msg.session_id ?? null,
      senderType: msg.sender_type,
      senderId: msg.sender_id,
      senderName: msg.sender_name,
      content: msg.content,
      messageType: msg.message_type,
      metadata,
      syncedAt: Math.floor(Date.now() / 1000),
      ...time,
    })
    .onConflictDoNothing()
    .run();
  if (result.changes === 0) return false;

  // Same renderer channel the local writer feeds — an open window shows the
  // teammate's message live; the renderer dedups by id against its own
  // cloud-socket copy (use-chat-messages.ts).
  const event: ChatMessageEvent = {
    id: msg.id,
    workItemId: msg.work_item_id,
    sessionId: msg.session_id ?? null,
    senderType: msg.sender_type,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    content: msg.content,
    messageType: msg.message_type,
    metadata,
    ...time,
  };
  events.emit(chatMessageChannel, event, msg.work_item_id);
  return true;
}

/**
 * REST catch-up for one work item's room chat — the recovery path for every
 * frame the device socket can miss (offline, reconnect, room-seq gap). Pages
 * backward from the newest cloud message; a page that overlaps local history
 * (any row deduped) means everything older is already local, so the walk
 * stops. Idempotent by id like everything else in this file.
 *
 * Note: the list endpoint trims oversized agent_turn metadata (server
 * trimForList) — those rows are the owner's own turns and dedup before the
 * trimmed copy could land.
 */
export async function reseedWorkItemChat(workItemId: string): Promise<number> {
  let before: string | undefined;
  let ingested = 0;

  for (let page = 0; page < RESEED_MAX_PAGES; page++) {
    const rows = await fetchCloudMessagesPage(workItemId, { limit: RESEED_PAGE_SIZE, before });
    if (rows.length === 0) break;

    let inserted = 0;
    for (const row of rows) {
      if (ingestCloudChatMessage(row)) inserted += 1;
    }
    ingested += inserted;

    const overlappedLocal = inserted < rows.length;
    if (overlappedLocal || rows.length < RESEED_PAGE_SIZE) break;
    if (page === RESEED_MAX_PAGES - 1) {
      log.warn('[chat-ingest] reseed hit page cap before overlapping local history', {
        workItemId,
        ingested,
      });
      break;
    }
    // Ascending within the page — rows[0] is the oldest; walk past it.
    const oldest = rows[0];
    before = `${oldest.created_at},${oldest.id}`;
  }

  if (ingested > 0) {
    log.info('[chat-ingest] reseed ingested messages', { workItemId, ingested });
  }
  return ingested;
}
