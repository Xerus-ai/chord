import type { CloudChatMessage } from '@chord/protocol';
import { startTransition, useCallback, useEffect, useRef } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';

// Matches the server's POST /hydrate cap (server/src/routes/messages.ts
// HydrateMessagesSchema) — hydrateMessages chunks larger id lists to this
// size so one seed page's worth of trimmed rows costs a handful of requests,
// not one per row.
const HYDRATE_BATCH_SIZE = 50;
// A full 500-row seed is ~10 chunks; cap how many run at once rather than
// firing all of them together.
const HYDRATE_CHUNK_CONCURRENCY = 2;

/**
 * Full rows for messages the list endpoint trimmed (use-cloud-chat.ts), one at
 * a time or in batches, merged into the feed as they land.
 */
export function useCloudChatHydrate(
  workItemId: string,
  mergeRows: (incoming: CloudChatMessage[]) => void
) {
  // Shared by hydrateMessage and hydrateMessages — an id in flight through
  // either path is skipped by the other, so a batch call racing a stray
  // single call for the same id can't double-fetch.
  const hydratingRef = useRef(new Set<string>());
  const chunkQueueRef = useRef<string[][]>([]);
  const chunkInFlightRef = useRef(0);

  // The list endpoint trims oversized metadata (metadata.truncated); this
  // pulls one full row so a consumer can render it. Guarded by an in-flight
  // set rather than checking `messages` for the trimmed marker: once merged,
  // the row is no longer truncated, so a second call for the same id is
  // simply a no-op through this guard.
  const hydrateMessage = useCallback(
    (id: string) => {
      if (hydratingRef.current.has(id)) return;
      hydratingRef.current.add(id);
      cloudApi
        .getMessage(workItemId, id)
        .then((row) => startTransition(() => mergeRows([row])))
        .catch((err: Error) => {
          console.error('[cloud-chat] hydrate failed:', err.message);
        })
        .finally(() => {
          hydratingRef.current.delete(id);
        });
    },
    [workItemId, mergeRows]
  );

  // Runs one chunk, then drains the next queued chunk on completion. Via a
  // ref (rather than the useCallback binding referencing itself) so the
  // recursive call always dispatches through the current closure — a stale
  // self-reference across a workItemId change would fetch under the wrong id.
  const runChunkRef = useRef<(chunk: string[]) => void>(() => {});
  const runChunk = useCallback(
    (chunk: string[]) => {
      chunkInFlightRef.current++;
      cloudApi
        .hydrateMessages(workItemId, chunk)
        .then((rows) => startTransition(() => mergeRows(rows)))
        .catch((err: Error) => {
          console.error('[cloud-chat] batch hydrate failed:', err.message);
        })
        .finally(() => {
          chunkInFlightRef.current--;
          for (const id of chunk) hydratingRef.current.delete(id);
          const next = chunkQueueRef.current.shift();
          if (next !== undefined) runChunkRef.current(next);
        });
    },
    [workItemId, mergeRows]
  );
  useEffect(() => {
    runChunkRef.current = runChunk;
  }, [runChunk]);

  // Batch counterpart for a list of ids gathered at once (see the doc
  // comment on CloudChatFeed.hydrateMessages) — splits into
  // HYDRATE_BATCH_SIZE-sized chunks, at most HYDRATE_CHUNK_CONCURRENCY of
  // which run at once; the rest queue and drain as chunks finish. Each
  // chunk's response merges in one mergeRows call.
  const hydrateMessages = useCallback(
    (ids: string[]) => {
      const pending = ids.filter((id) => !hydratingRef.current.has(id));
      if (pending.length === 0) return;
      for (const id of pending) hydratingRef.current.add(id);

      for (let i = 0; i < pending.length; i += HYDRATE_BATCH_SIZE) {
        const chunk = pending.slice(i, i + HYDRATE_BATCH_SIZE);
        if (chunkInFlightRef.current >= HYDRATE_CHUNK_CONCURRENCY) {
          chunkQueueRef.current.push(chunk);
        } else {
          runChunk(chunk);
        }
      }
    },
    [runChunk]
  );

  return { hydrateMessage, hydrateMessages };
}
