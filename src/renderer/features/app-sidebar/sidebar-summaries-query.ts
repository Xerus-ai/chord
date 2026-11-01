import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { CompareBaseMode } from '@shared/git-settings';
import type { SidebarSummary } from '@shared/sidebar-summaries';

const SIDEBAR_SUMMARIES = ['sidebar', 'summaries'] as const;

/** The summaries of the work items in `stableKey` (ids joined by commas), per compare base. */
export function sidebarSummariesQueryKey(
  stableKey: string,
  compareBaseMode: CompareBaseMode | null
) {
  return [...SIDEBAR_SUMMARIES, stableKey, compareBaseMode] as const;
}

/**
 * The sidebar's summaries query. A new compare base or a new set of work
 * items is a new key; until it loads, the rows keep the summaries they had,
 * so they keep their stats, unread dots and place — the "attention" sort
 * reads each item's bucket from its summary (devstation-e7t).
 */
export function sidebarSummariesQueryOptions({
  stableKey,
  compareBaseMode,
  fetchSummaries,
}: {
  stableKey: string;
  compareBaseMode: CompareBaseMode | null;
  fetchSummaries: () => Promise<SidebarSummary[]>;
}) {
  return {
    queryKey: sidebarSummariesQueryKey(stableKey, compareBaseMode),
    queryFn: fetchSummaries,
    placeholderData: keepPreviousData,
    enabled: stableKey !== '' && compareBaseMode !== null,
    refetchInterval: 10000,
  };
}

/**
 * Re-reads every summaries query that covers `workItemId`, under any compare
 * base — and no other, so one work item's session change doesn't refetch
 * every sidebar list.
 */
export function invalidateSidebarSummariesFor(
  queryClient: QueryClient,
  workItemId: string
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: SIDEBAR_SUMMARIES,
    predicate: (query) => {
      const ids = query.queryKey[2];
      return typeof ids === 'string' && ids.split(',').includes(workItemId);
    },
  });
}
