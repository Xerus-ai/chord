import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { sidebarSummariesQueryKey } from '@renderer/features/app-sidebar/sidebar-summaries-query';
import { refreshChanges } from './refresh-changes';

/**
 * "Refresh changes" re-reads the lane's git state for the panel and for the
 * work item's sidebar row, which shows the same lane's +/− (devstation-e7t):
 * after the branch's remote copy was deleted outside the app, the panel said
 * "no upstream" while the row kept "+9 −0" until its next 10 s poll.
 * A real QueryClient.
 */
describe('refreshChanges', () => {
  it("re-reads the panel's git queries and the work item's sidebar summaries", async () => {
    const client = new QueryClient();
    const rail = ['rail', 'git', 'status', 'wt-1'] as const;
    const row = sidebarSummariesQueryKey('wi-1,wi-2', 'upstream');
    const otherItem = sidebarSummariesQueryKey('wi-3', 'upstream');
    for (const key of [rail, row, otherItem]) client.setQueryData(key, []);

    await refreshChanges(client, 'wi-1');

    expect(client.getQueryState(rail)?.isInvalidated).toBe(true);
    expect(client.getQueryState(row)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherItem)?.isInvalidated).toBe(false);
  });
});
