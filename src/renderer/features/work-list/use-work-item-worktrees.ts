import { useQuery } from '@tanstack/react-query';
import { laneSetupChangedChannel } from '@shared/events/workItemEvents';
import type { Worktree } from '@shared/worktrees';
import { events, rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { describeRpcFailure } from './describe-action-failure';

const worktreesQueryKey = (workItemId: string) => ['worktrees', 'list', workItemId] as const;

/** Refreshes a work item's lanes the moment one's setup changes state. */
export function wireLaneSetupInvalidation(): void {
  events.on(laneSetupChangedChannel, ({ workItemId }) => {
    void queryClient.invalidateQueries({ queryKey: worktreesQueryKey(workItemId) });
  });
}

/** A work item's live worktrees, primary first (`worktrees.list` order). */
export function useWorkItemWorktrees(workItemId: string): Worktree[] | undefined {
  const { data } = useQuery({
    queryKey: worktreesQueryKey(workItemId),
    queryFn: async () => {
      const result = await rpc.worktrees.list(workItemId);
      if (!result.success) throw new Error(describeRpcFailure('List worktrees', result.error));
      return result.data.worktrees;
    },
    staleTime: 5000,
  });
  return data;
}
