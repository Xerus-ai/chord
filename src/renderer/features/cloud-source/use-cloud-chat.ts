import type { CloudChatMessage, CloudCommand } from '@chord/protocol';
import { useMemo } from 'react';
import { useWorkItemRoom } from '@renderer/lib/sync/use-work-item-room';
import { useCloudChatFeedState } from './use-cloud-chat-feed';
import { useCloudChatHydrate } from './use-cloud-chat-hydrate';
import { useCloudChatSend } from './use-cloud-chat-send';

export interface CloudChatFeed {
  /** All known rows, ascending (created_at, id). */
  messages: CloudChatMessage[];
  /** Ids sent from this window that no ack has confirmed yet. */
  pendingIds: ReadonlySet<string>;
  /**
   * Ids the server rejected — dropped from the re-send set, so they are never
   * retried, and surfaced so the row renders as undelivered instead of
   * sitting at pending opacity forever.
   */
  failedIds: ReadonlySet<string>;
  isSeeding: boolean;
  /** The newest page has been read (or failed to be): older pages are asked for from it. */
  seeded: boolean;
  hasOlder: boolean;
  loadOlder: () => void;
  /** Pages back until the feed holds `target`; false when history ends first (step 5). */
  loadThrough: (target: Pick<CloudChatMessage, 'created_at' | 'id'>) => Promise<boolean>;
  /** Returns the sent message's id, or null when the socket is closed — the caller keeps the draft. */
  /**
   * `sessionId` is the thread the composer is open on — null only when the
   * item has no threads at all. The server refuses an id that is not a
   * session of this work item.
   */
  sendMessage: (content: string, sessionId: string | null) => string | null;
  /**
   * Posts a `prompt` command (design doc §5's "send to agent"): the server
   * inserts the room-visible chat row atomically with the command; the
   * owner's device delivers it into the agent session. No optimistic append
   * — the row merges on the POST response (and again via the room
   * broadcast, idempotent by id). REJECTS on failure (a CloudApiError
   * carries the server status) — the caller keeps the draft and shows the
   * reason; a swallowed rejection here is a dead-feeling button. Resolves
   * the command and the id of the chat row it inserted.
   */
  sendPromptToAgent: (
    content: string,
    sessionId: string | null
  ) => Promise<{ command: CloudCommand; chatMessageId: string }>;
  /**
   * Fetches the full row for a message the list endpoint trimmed
   * (metadata.truncated) and merges it in. No-op if already in flight.
   */
  hydrateMessage: (id: string) => void;
  /**
   * Batch form of hydrateMessage — chunks `ids` into groups of
   * HYDRATE_BATCH_SIZE and issues one POST /hydrate per chunk (at most
   * HYDRATE_CHUNK_CONCURRENCY in flight at once), merging each chunk's
   * response in one call. Use this over looping hydrateMessage for any list
   * of ids gathered at once (e.g. every truncated row in a seed page) — the
   * whole point is trading N single-row requests for a handful of batched
   * ones.
   */
  hydrateMessages: (ids: string[]) => void;
}

// Stable reference for the no-messages case so consumers keying off
// `messages` identity (each chat tab's transcript useMemo) don't see a
// change when there's nothing to show.
const EMPTY_MESSAGES: CloudChatMessage[] = [];

/**
 * Cloud chat feed for one work item: live subscription first, then a
 * newest-page REST seed merged by id (a broadcast landing mid-seed can never
 * be lost or duplicated), older pages on demand, and an `?after=` incremental
 * reseed on every reconnect. Sending uses client-generated UUIDv7 ids with
 * optimistic append; the server ack carries the canonical created_at, and
 * un-acked sends are re-sent when the room is re-joined (idempotent by id).
 */
export function useCloudChat(workItemId: string): CloudChatFeed {
  const roomStatus = useWorkItemRoom(workItemId);
  const { state, setState, mergeRows, unconfirmedIdsRef, loadOlder, loadThrough } =
    useCloudChatFeedState(workItemId);
  const { pendingIds, failedIds, sendMessage, sendPromptToAgent } = useCloudChatSend({
    workItemId,
    roomStatus,
    setState,
    mergeRows,
    unconfirmedIdsRef,
  });
  const { hydrateMessage, hydrateMessages } = useCloudChatHydrate(workItemId, mergeRows);

  const scoped = state && state.workItemId === workItemId ? state : null;
  const messages = scoped ? scoped.order : EMPTY_MESSAGES;
  const seeded = scoped?.seeded ?? false;
  const isSeeding = !seeded && messages.length === 0;
  const hasOlder = scoped?.hasOlder ?? false;

  // One object per change, not per render: every chat tab reads it through
  // CloudChatProvider's context.
  return useMemo(
    () => ({
      messages,
      pendingIds,
      failedIds,
      isSeeding,
      seeded,
      hasOlder,
      loadOlder,
      loadThrough,
      sendMessage,
      sendPromptToAgent,
      hydrateMessage,
      hydrateMessages,
    }),
    [
      messages,
      pendingIds,
      failedIds,
      isSeeding,
      seeded,
      hasOlder,
      loadOlder,
      loadThrough,
      sendMessage,
      sendPromptToAgent,
      hydrateMessage,
      hydrateMessages,
    ]
  );
}
