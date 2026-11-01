import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { describeRpcFailure } from './describe-action-failure';

/**
 * Live git state for a work item. Every query throws on a failed call so the
 * failure lands in react-query's error channel — a swallowed git error used to
 * render as "No file changes", which is indistinguishable from a clean tree.
 *
 * `worktreeId` scopes file changes, commits, branch, and PR to that worktree;
 * omitted reads the primary.
 */
export function useWorkItemGit(workItemId: string | undefined, worktreeId?: string) {
  const {
    data: statusData,
    isPending: statusLoading,
    error: statusError,
  } = useQuery({
    queryKey: ['workItem', 'gitStatus', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.getGitStatus(workItemId!, worktreeId);
      if (!result.success) throw new Error(describeRpcFailure('Read file changes', result.error));
      return result.data.files;
    },
    enabled: !!workItemId,
    refetchInterval: 5000,
  });

  const { data: logData, error: logError } = useQuery({
    queryKey: ['workItem', 'gitLog', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.getGitLog(workItemId!, 10, worktreeId);
      if (!result.success) throw new Error(describeRpcFailure('Read commits', result.error));
      return result.data.commits;
    },
    enabled: !!workItemId,
    refetchInterval: 5000,
  });

  const { data: branchInfo } = useQuery({
    queryKey: ['workItem', 'gitBranchInfo', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.getGitBranchInfo(workItemId!, worktreeId);
      if (!result.success) throw new Error(describeRpcFailure('Read branch', result.error));
      return result.data;
    },
    enabled: !!workItemId,
    refetchInterval: 10000,
  });

  const { data: prInfo } = useQuery({
    queryKey: ['workItem', 'prInfo', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.getPrInfo(workItemId!, worktreeId);
      if (!result.success) throw new Error(describeRpcFailure('Read pull request', result.error));
      return result.data.pr;
    },
    enabled: !!workItemId,
    refetchInterval: 15000,
  });

  const error = statusError ?? logError;

  return {
    files: statusData ?? [],
    commits: logData ?? [],
    loading: statusLoading,
    error: error instanceof Error ? error.message : null,
    currentBranch: branchInfo?.currentBranch ?? null,
    // Unknown until the branch query resolves — callers render nothing rather
    // than asserting a base branch this repository may not have.
    defaultBranch: branchInfo?.defaultBranch ?? null,
    prInfo: prInfo ?? null,
  };
}
