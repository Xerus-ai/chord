import type { CloudChatMessage } from '@chord/protocol';
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import {
  applyBatch,
  cursorOf,
  emptyState,
  lastServerConfirmed,
  reachesBack,
  type CloudChatState,
} from './cloud-chat-store';

const PAGE_SIZE = 100;
/** A reveal pages back in the largest pages the server serves (messages.ts). */
const REVEAL_PAGE_SIZE = 500;

/** The item's rows as the feed holds them, and what the send and hydrate halves write through. */
export interface CloudChatFeedState {
  state: CloudChatState | null;
  setState: Dispatch<SetStateAction<CloudChatState | null>>;
  mergeRows: (incoming: CloudChatMessage[]) => void;
  /**
   * Rows appended optimistically whose created_at is still this machine's
   * clock. An id leaves the set only when its ack rewrites created_at with the
   * server's value; a rejected send never leaves it, because the server never
   * stored that row at all. Read by lastServerConfirmed to keep clock skew out
   * of the reconnect cursor.
   */
  unconfirmedIdsRef: MutableRefObject<Set<string>>;
  loadOlder: () => void;
  /**
   * Pages back until the feed holds `target` (shared-items step 5): true once
   * it does, false when the item's history ends first. Call once seeded.
   */
  loadThrough: (target: Pick<CloudChatMessage, 'created_at' | 'id'>) => Promise<boolean>;
}

/**
 * The receiving half of the cloud chat feed (use-cloud-chat.ts): live
 * subscription first, then a newest-page REST seed merged by id (a broadcast
 * landing mid-seed can never be lost or duplicated), older pages on demand,
 * and an `?after=` incremental reseed on every reconnect.
 */
export function useCloudChatFeedState(workItemId: string): CloudChatFeedState {
  const { subscribeEvent } = useSyncSocketContext();
  const [state, setState] = useState<CloudChatState | null>(null);
  // Live reads inside long-lived socket handlers — never captured state. A
  // layout effect, so a chat tab's own effects (which run before this
  // provider's passive ones) already read the committed state: a reveal asks
  // loadThrough right after the feed is seeded.
  const stateRef = useRef<CloudChatState | null>(null);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const unconfirmedIdsRef = useRef(new Set<string>());
  // Bursts of `chat_message_received` (a reconnect replaying several rooms,
  // several WS frames landing in the same tick) each used to trigger their
  // own state copy and re-render. Buffer them and flush once per animation
  // frame so a burst of M events costs one merge, not M.
  const incomingBufferRef = useRef<CloudChatMessage[]>([]);
  const flushHandleRef = useRef<number | null>(null);

  const mergeRows = useCallback(
    (incoming: CloudChatMessage[]) => {
      if (incoming.length === 0) return;
      setState((prev) => applyBatch(prev, workItemId, incoming));
    },
    [workItemId]
  );

  const flushIncoming = useCallback(() => {
    flushHandleRef.current = null;
    const batch = incomingBufferRef.current;
    if (batch.length === 0) return;
    incomingBufferRef.current = [];
    startTransition(() => mergeRows(batch));
  }, [mergeRows]);

  // Subscriptions are registered before any fetch resolves; handlers use
  // functional setState only, so nothing here ever resubscribes the socket
  // (a resubscribe gap is a missed message).
  useEffect(() => {
    const unsubscribeReceived = subscribeEvent(
      'chat_message_received',
      (payload) => {
        incomingBufferRef.current.push(payload);
        if (flushHandleRef.current === null) {
          flushHandleRef.current = requestAnimationFrame(flushIncoming);
        }
      },
      workItemId
    );

    // Owner history bulk pushes (PUT /bulk) land as one frame carrying every
    // newly-inserted row above the server's INDIVIDUAL_BROADCAST_MAX — feed
    // the same buffer as chat_message_received so a backfill of M rows still
    // costs one merge, not M.
    const unsubscribeBulkReceived = subscribeEvent(
      'chat_messages_bulk_received',
      (payload) => {
        incomingBufferRef.current.push(...payload.messages);
        if (flushHandleRef.current === null) {
          flushHandleRef.current = requestAnimationFrame(flushIncoming);
        }
      },
      workItemId
    );

    const unsubscribeConnected = subscribeEvent('$sync/connected', () => {
      const current = stateRef.current;
      if (!current || current.workItemId !== workItemId || !current.seeded) return;
      const latest = lastServerConfirmed(current.order, unconfirmedIdsRef.current);
      // Fetch only what the outage may have dropped — never the whole history.
      cloudApi
        .getMessages(workItemId, latest ? { after: cursorOf(latest) } : { limit: PAGE_SIZE })
        .then((rows) => startTransition(() => mergeRows(rows)))
        .catch((err: Error) => {
          console.error('[cloud-chat] reconnect reseed failed:', err.message);
        });
    });

    return () => {
      unsubscribeReceived();
      unsubscribeBulkReceived();
      unsubscribeConnected();
      if (flushHandleRef.current !== null) {
        cancelAnimationFrame(flushHandleRef.current);
        flushHandleRef.current = null;
      }
      incomingBufferRef.current = [];
    };
  }, [workItemId, subscribeEvent, mergeRows, flushIncoming]);

  // Newest-page seed, after the subscriptions above are live.
  useEffect(() => {
    let stale = false;
    cloudApi
      .getMessages(workItemId, { limit: PAGE_SIZE })
      .then((rows) => {
        if (stale) return;
        startTransition(() => {
          mergeRows(rows);
          setState((prev) => {
            if (!prev || prev.workItemId !== workItemId) {
              return {
                ...emptyState(workItemId),
                seeded: true,
                hasOlder: rows.length === PAGE_SIZE,
              };
            }
            return { ...prev, seeded: true, hasOlder: rows.length === PAGE_SIZE };
          });
        });
      })
      .catch((err: Error) => {
        if (stale) return;
        console.error('[cloud-chat] seed failed:', err.message);
        // Live broadcasts still land; stop reporting "seeding" forever.
        setState((prev) =>
          prev && prev.workItemId === workItemId
            ? { ...prev, seeded: true }
            : { ...emptyState(workItemId), seeded: true }
        );
      });
    return () => {
      stale = true;
    };
  }, [workItemId, mergeRows]);

  const loadOlder = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.workItemId !== workItemId || !current.hasOlder) return;
    const oldest = current.order[0];
    if (!oldest) return;
    cloudApi
      .getMessages(workItemId, { before: cursorOf(oldest), limit: PAGE_SIZE })
      .then((rows) => {
        startTransition(() => {
          mergeRows(rows);
          setState((prev) =>
            prev && prev.workItemId === workItemId
              ? { ...prev, hasOlder: rows.length === PAGE_SIZE }
              : prev
          );
        });
      })
      .catch((err: Error) => {
        console.error('[cloud-chat] older page failed:', err.message);
      });
  }, [workItemId, mergeRows]);

  // One page at a time, each merged before the next is asked for; not in a
  // transition, so the rows are in state by the time the caller looks for its
  // target. Bounded by the item's history: a short page is its start.
  const loadThrough = useCallback(
    async (target: Pick<CloudChatMessage, 'created_at' | 'id'>): Promise<boolean> => {
      const current = stateRef.current;
      if (!current || current.workItemId !== workItemId || !current.seeded) {
        throw new Error('loadThrough needs the seeded feed');
      }
      let oldest = current.order[0];
      if (reachesBack(current.order, target)) return true;
      let hasOlder = current.hasOlder;
      while (oldest && hasOlder) {
        const rows = await cloudApi.getMessages(workItemId, {
          before: cursorOf(oldest),
          limit: REVEAL_PAGE_SIZE,
        });
        hasOlder = rows.length === REVEAL_PAGE_SIZE;
        mergeRows(rows);
        const olderStill = hasOlder;
        setState((prev) =>
          prev && prev.workItemId === workItemId ? { ...prev, hasOlder: olderStill } : prev
        );
        if (rows.length === 0) return false;
        oldest = rows[0];
        if (reachesBack(rows, target)) return true;
      }
      return false;
    },
    [workItemId, mergeRows]
  );

  return { state, setState, mergeRows, unconfirmedIdsRef, loadOlder, loadThrough };
}
