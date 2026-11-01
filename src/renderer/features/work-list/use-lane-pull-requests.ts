import { useQuery, type QueryClient } from '@tanstack/react-query';
import { pullRequestErrorMessage } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';

export function lanePullRequestsKey(workItemId: string | undefined) {
  return ['workItem', 'lanePrs', workItemId] as const;
}

/**
 * Every lane of the work item with its pull request (plan 2026-09-26 P8). One
 * cache entry for the band, Create PR, the header's PR list and Merge, polled
 * so a PR opened or merged on GitHub shows up without reopening anything.
 */
export function useLanePullRequests(workItemId: string | undefined) {
  return useQuery({
    queryKey: lanePullRequestsKey(workItemId),
    queryFn: async () => {
      const result = await rpc.pullRequests.getLanePullRequests(workItemId!);
      if (result.success) return result.data;
      throw new Error(`Load pull requests failed: ${pullRequestErrorMessage(result.error)}`);
    },
    enabled: !!workItemId,
    refetchInterval: 15000,
  });
}

/** Everything that shows a lane's PR, after one was opened, merged or marked ready. */
export async function invalidateLanePrViews(
  queryClient: QueryClient,
  workItemId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: lanePullRequestsKey(workItemId) }),
    queryClient.invalidateQueries({ queryKey: ['workItem', 'checks', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['workItem', 'reviews', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['workItem', 'prInfo', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['sidebar', 'summaries'] }),
    queryClient.invalidateQueries({ queryKey: ['workItems'] }),
  ]);
}
