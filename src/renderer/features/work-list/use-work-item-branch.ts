import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { describeRpcFailure } from './describe-action-failure';

/**
 * The work item's current branch, and nothing else.
 *
 * `useWorkItemGit` answers the same question, but only as part of four polling
 * queries (status, log, branch, PR) — mounting it in the composer just to read
 * a branch name would start three more poll loops for data the composer never
 * renders. The query key is identical to the branch query there, so when both
 * are mounted react-query serves them from one cache entry and one poll.
 */
export function useWorkItemBranch(
  workItemId: string | undefined,
  worktreeId?: string
): string | null {
  const { data } = useQuery({
    queryKey: ['workItem', 'gitBranchInfo', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.getGitBranchInfo(workItemId!, worktreeId);
      if (!result.success) throw new Error(describeRpcFailure('Read branch', result.error));
      return result.data;
    },
    enabled: !!workItemId,
    refetchInterval: 10000,
  });

  return data?.currentBranch ?? null;
}
