import type { QueryClient } from '@tanstack/react-query';

/**
 * Refetches every reader of a work item's lanes after one is archived,
 * restored, promoted or deleted: the sidebar summaries, the lane lists the
 * centre and rail read, the sessions, the work item (its repo path follows
 * the primary), and the rail's git reads. Those are keyed by lane and poll
 * slowly, so a read that failed while a lane had no checkout would otherwise
 * stay on screen after Restore (devstation-b3d4).
 */
export async function refreshLaneReaders(
  queryClient: QueryClient,
  workItemId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['sidebar', 'summaries'] }),
    queryClient.invalidateQueries({ queryKey: ['worktrees', 'list', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['worktrees', 'archived', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['worktrees', 'projectId'] }),
    queryClient.invalidateQueries({ queryKey: ['agentSessions', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['workItems'] }),
    queryClient.invalidateQueries({ queryKey: ['rail', 'git'] }),
  ]);
}

/**
 * Drops a lane's cached rail git reads (keyed `['rail', 'git', <read>, laneId,
 * …]`). Restore calls it before the lane comes back: a read that failed
 * while the lane had no checkout would otherwise show its error until the
 * refetch lands, and nothing observes the archived lane's reads to refetch
 * them sooner (devstation-b3d4).
 */
export function forgetLaneGitReads(queryClient: QueryClient, laneId: string): void {
  queryClient.removeQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'rail' && queryKey[1] === 'git' && queryKey[3] === laneId,
  });
}
