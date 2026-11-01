import type { QueryClient } from '@tanstack/react-query';
import { invalidateSidebarSummariesFor } from '@renderer/features/app-sidebar/sidebar-summaries-query';

/**
 * "Refresh changes": re-reads the lane's git state for the Changes panel and
 * for the work item's sidebar row, which shows the same lane's +/− and
 * compare base. Refreshing only the panel left the row on its old numbers
 * until its next poll (devstation-e7t).
 */
export async function refreshChanges(queryClient: QueryClient, workItemId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['rail', 'git'] }),
    invalidateSidebarSummariesFor(queryClient, workItemId),
  ]);
}
