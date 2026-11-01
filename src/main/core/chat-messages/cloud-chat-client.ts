import type { CloudChatBulkMessage, CloudChatMessage } from '@chord/protocol';
import {
  cloudFetch,
  toSendResult,
  type SendResult,
} from '@main/core/work-items/cloud-work-items-client';

// Request budget: the bulk route's path-scoped parser allows 2MB; chunking at
// ~256KB serialized keeps requests well inside it and bounds retry cost.
const CHUNK_BYTE_BUDGET = 256 * 1024;
// Server-side array cap on the bulk schema.
const CHUNK_MAX_MESSAGES = 500;

function chunkByByteBudget(messages: CloudChatBulkMessage[]): CloudChatBulkMessage[][] {
  const chunks: CloudChatBulkMessage[][] = [];
  let current: CloudChatBulkMessage[] = [];
  let currentBytes = 0;
  for (const message of messages) {
    const bytes = JSON.stringify(message).length;
    if (
      current.length > 0 &&
      (currentBytes + bytes > CHUNK_BYTE_BUDGET || current.length >= CHUNK_MAX_MESSAGES)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(message);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Pushes owner chat history to the creator-only bulk endpoint in byte-budgeted
 * chunks. A failed chunk fails the whole operation — the queue retries all
 * chunks, which is safe because the server upsert is idempotent by id.
 */
/**
 * One keyset page of a work item's cloud chat history, ascending
 * (created_at, id) within the page. `before` is the server's
 * "<created_at ISO>,<id>" cursor — omitted, the newest page. Used by the
 * ingestion reseed (chat-ingestion.ts) to catch up after a device-socket
 * reconnect or room-seq gap.
 */
export async function fetchCloudMessagesPage(
  workItemId: string,
  opts: { limit: number; before?: string }
): Promise<CloudChatMessage[]> {
  const params = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.before) params.set('before', opts.before);
  const res = await cloudFetch(`/work-items/${workItemId}/messages?${params.toString()}`);
  if (!res.ok) throw new Error(`messages fetch failed: ${res.status}`);
  return (await res.json()) as CloudChatMessage[];
}

export async function pushChatMessagesBulk(
  workItemId: string,
  messages: CloudChatBulkMessage[]
): Promise<SendResult> {
  for (const chunk of chunkByByteBudget(messages)) {
    const res = await cloudFetch(`/work-items/${workItemId}/messages/bulk`, {
      method: 'PUT',
      body: JSON.stringify({ messages: chunk }),
    });
    const result = await toSendResult(res, false);
    if (!result.ok) return result;
  }
  return { ok: true };
}
