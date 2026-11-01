import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { SidebarSummary } from '@shared/sidebar-summaries';
import { sidebarSummariesQueryOptions } from './sidebar-summaries-query';

/**
 * Rows keep their place and their last values while new summaries load
 * (devstation-e7t). Changing Settings › Git › Compare base, or the set of
 * work items, is a new query key; with nothing to show for it, every row lost
 * its stats and unread dot and the "attention" sort, which reads each item's
 * bucket from its summary, reordered the list until the fetch landed. A real
 * QueryClient and observer, as the hook uses them.
 */
const summary = (id: string) => ({ id }) as unknown as SidebarSummary;

describe('sidebarSummariesQueryOptions', () => {
  it('keeps the previous summaries while a new compare base loads', async () => {
    const client = new QueryClient();
    const observer = new QueryObserver(
      client,
      sidebarSummariesQueryOptions({
        stableKey: 'wi-a,wi-b',
        compareBaseMode: 'repoDefault',
        fetchSummaries: async () => [summary('wi-a'), summary('wi-b')],
      })
    );
    const unsubscribe = observer.subscribe(() => {});
    await client.fetchQuery(observer.options);
    expect(observer.getCurrentResult().data).toHaveLength(2);

    let release: (rows: SidebarSummary[]) => void = () => {};
    observer.setOptions(
      sidebarSummariesQueryOptions({
        stableKey: 'wi-a,wi-b',
        compareBaseMode: 'upstream',
        fetchSummaries: () => new Promise((resolve) => (release = resolve)),
      })
    );

    const loading = observer.getCurrentResult();
    expect(loading.isPlaceholderData).toBe(true);
    expect(loading.data?.map((row) => row.id)).toEqual(['wi-a', 'wi-b']);

    release([summary('wi-a')]);
    await client.fetchQuery(observer.options);
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    unsubscribe();
  });
});
