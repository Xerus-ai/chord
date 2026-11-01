import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { SidebarLastViewedAtSnapshot } from '@shared/view-state';
import { rpc } from '@renderer/lib/ipc';
import { createSerialWriteQueue } from './serial-write-queue';

const LAST_VIEWED_AT_KEY = 'sidebar.lastViewedAt';

// Leaving one item and opening the next fire back to back; queueing the
// read-modify-writes keeps the second from overwriting the first's entry.
const enqueueViewedWrite = createSerialWriteQueue();

/** Resolves true when this write was the last queued: the summaries are re-read then. */
function recordViewed(workItemId: string): Promise<boolean> {
  return enqueueViewedWrite(async () => {
    const current = (await rpc.viewState.get(
      LAST_VIEWED_AT_KEY
    )) as SidebarLastViewedAtSnapshot | null;
    await rpc.viewState.save(LAST_VIEWED_AT_KEY, {
      ...current,
      [workItemId]: Math.floor(Date.now() / 1000),
    });
  });
}

/**
 * Persists `sidebar.lastViewedAt` for the open work item — when it opens, and
 * again when the user leaves it, so what arrived while they were looking
 * counts as seen. Main reads it for unseen mentions and unread finished turns.
 */
export function useMarkWorkItemViewed(workItemId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!workItemId) return;
    const record = () =>
      recordViewed(workItemId).then(
        // Once per burst: re-reading the summaries runs git across every
        // worktree, and a click (leave one item, open the next) writes twice.
        (drained) =>
          drained
            ? queryClient.invalidateQueries({ queryKey: ['sidebar', 'summaries'] })
            : undefined,
        (error: unknown) => {
          console.error(
            '[sidebar] recording last viewed failed:',
            error instanceof Error ? error.message : error
          );
        }
      );
    void record();
    return () => {
      void record();
    };
  }, [workItemId, queryClient]);
}
