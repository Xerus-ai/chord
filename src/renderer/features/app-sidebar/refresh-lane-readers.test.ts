import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { forgetLaneGitReads, refreshLaneReaders } from './refresh-lane-readers';

/**
 * After a lane is archived, restored, promoted or deleted, everything that
 * reads it is refetched: the right rail's git reads included, or a read that
 * failed while the lane had no checkout ("Read commits failed: not_found")
 * stays on screen until its next poll (devstation-b3d4).
 */
function seededClient(keys: unknown[][]): QueryClient {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData(key, { seeded: true });
  return client;
}

const isInvalidated = (client: QueryClient, key: unknown[]) =>
  client.getQueryState(key)?.isInvalidated ?? false;

describe('refreshLaneReaders', () => {
  it("invalidates the rail's git reads of the lane", async () => {
    const keys = [
      ['rail', 'git', 'log', 'lane-a2', 20],
      ['rail', 'git', 'fullStatus', 'lane-a2'],
      ['worktrees', 'projectId', 'lane-a2'],
    ];
    const client = seededClient(keys);

    await refreshLaneReaders(client, 'item-a');

    for (const key of keys) expect(isInvalidated(client, key), key.join('/')).toBe(true);
  });

  it("invalidates the work item's lane lists, sessions and the sidebar", async () => {
    const keys = [
      ['sidebar', 'summaries'],
      ['worktrees', 'list', 'item-a'],
      ['worktrees', 'archived', 'item-a'],
      ['agentSessions', 'item-a'],
      ['workItems'],
    ];
    const client = seededClient(keys);

    await refreshLaneReaders(client, 'item-a');

    for (const key of keys) expect(isInvalidated(client, key), key.join('/')).toBe(true);
  });
});

describe('forgetLaneGitReads', () => {
  it("drops the lane's cached rail git reads, so a read that failed while it had no checkout is never shown again", () => {
    const client = seededClient([
      ['rail', 'git', 'log', 'lane-a2', 20],
      ['rail', 'git', 'fullStatus', 'lane-a2'],
      ['rail', 'git', 'committed', 'lane-a2', 'base'],
      ['rail', 'git', 'log', 'lane-a', 20],
      ['worktrees', 'list', 'item-a'],
    ]);

    forgetLaneGitReads(client, 'lane-a2');

    expect(client.getQueryState(['rail', 'git', 'log', 'lane-a2', 20])).toBeUndefined();
    expect(client.getQueryState(['rail', 'git', 'fullStatus', 'lane-a2'])).toBeUndefined();
    expect(client.getQueryState(['rail', 'git', 'committed', 'lane-a2', 'base'])).toBeUndefined();
    // Other lanes' reads and everything else stay.
    expect(client.getQueryState(['rail', 'git', 'log', 'lane-a', 20])).toBeDefined();
    expect(client.getQueryState(['worktrees', 'list', 'item-a'])).toBeDefined();
  });
});
