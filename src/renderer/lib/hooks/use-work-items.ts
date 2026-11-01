import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { workItemProvisionChangedChannel } from '@shared/events/workItemEvents';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { events, rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';

/**
 * The machine's own work items, as a single shared cache entry.
 *
 * Every surface that lists or resolves a local work item reads through this
 * hook. Per-component copies of `workItems.getAll()` are what let a freshly
 * created item exist in one list and not another: the sidebar polled, the
 * work-list panel fetched once at mount, and a sidebar-created item therefore
 * arrived as an id the panel's list had never heard of. The panel then treated
 * the miss as "must be someone else's cloud item" and looked it up over the
 * network, which 404s until the sync queue drains.
 */
export const WORK_ITEMS_QUERY_KEY = ['workItems', 'local'] as const;

/** Flips "Creating the checkout…" the moment background provisioning lands,
 *  instead of on the next 5s poll. */
export function wireWorkItemProvisionInvalidation(): void {
  events.on(workItemProvisionChangedChannel, () => {
    void queryClient.invalidateQueries({ queryKey: WORK_ITEMS_QUERY_KEY });
  });
}

const NO_ITEMS: WorkItemRow[] = [];

export function useWorkItems(): {
  items: WorkItemRow[];
  isLoading: boolean;
  isFetched: boolean;
  error: Error | null;
  refetchWorkItems: () => Promise<unknown>;
} {
  const query = useQuery({
    queryKey: WORK_ITEMS_QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.workItems.getAll();
      if (!result.success) throw new Error('workItems.getAll failed');
      return result.data.items;
    },
    refetchInterval: 5000,
  });

  return {
    // A stable empty array: this feeds memo deps in every consumer.
    items: query.data ?? NO_ITEMS,
    isLoading: query.isLoading,
    isFetched: query.isFetched,
    error: query.error,
    refetchWorkItems: query.refetch,
  };
}

/** Re-read the shared list now. Call after any local create, rename, or delete. */
export function useInvalidateWorkItems(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: WORK_ITEMS_QUERY_KEY });
  }, [queryClient]);
}
