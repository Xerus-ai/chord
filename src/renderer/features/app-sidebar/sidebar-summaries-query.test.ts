import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateSidebarSummariesFor, sidebarSummariesQueryKey } from './sidebar-summaries-query';

/**
 * A session started or ended in a work item (`agent:sessions-changed`) is read
 * into the sidebar at once rather than at its next 10s poll (devstation-6jg):
 * every summaries query that covers the work item is invalidated, and no
 * other. A real QueryClient.
 */
describe('invalidateSidebarSummariesFor', () => {
  function seed(client: QueryClient, key: readonly unknown[]) {
    client.setQueryData(key, []);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  it('invalidates the summaries that cover the work item, under every compare base', async () => {
    const client = new QueryClient();
    const both = sidebarSummariesQueryKey('wi-a,wi-b', 'repoDefault');
    const otherMode = sidebarSummariesQueryKey('wi-b', 'upstream');
    seed(client, both);
    seed(client, otherMode);

    await invalidateSidebarSummariesFor(client, 'wi-b');

    expect(client.getQueryState(both)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherMode)?.isInvalidated).toBe(true);
  });

  it('leaves summaries of other work items, and other sidebar queries, alone', async () => {
    const client = new QueryClient();
    const other = sidebarSummariesQueryKey('wi-a,wi-bb', 'repoDefault');
    const shared = ['sidebar', 'sharedWithMe'] as const;
    seed(client, other);
    seed(client, shared);

    await invalidateSidebarSummariesFor(client, 'wi-b');

    // `wi-bb` contains `wi-b` as text but is another work item.
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(client.getQueryState(shared)?.isInvalidated).toBe(false);
  });

  it('is the key the sidebar reads its summaries under', () => {
    expect(sidebarSummariesQueryKey('wi-a,wi-b', 'repoDefault')).toEqual([
      'sidebar',
      'summaries',
      'wi-a,wi-b',
      'repoDefault',
    ]);
  });
});
