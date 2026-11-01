import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { WORKTREE_SOURCES_QUERY_KEY } from './use-worktree-sources';
import { describeWorkItemDeleteConfirm } from './work-item-delete-confirm';

export interface DeletableWorkItem {
  id: string;
  name: string;
}

/**
 * Delete is offered for locally-owned work items only. `rpc.workItems.remove`
 * releases the item's checkpoint refs before dropping the row and enqueues the
 * cloud delete, so a failed cleanup must surface instead of being swallowed —
 * the refs are unreachable once the row is gone.
 */
export function useDeleteWorkItem(onDeleted?: (workItemId: string) => void) {
  const queryClient = useQueryClient();
  const showConfirm = useShowModal('confirmActionModal');

  const deleteMutation = useMutation({
    mutationFn: async (workItemId: string) => {
      const result = await rpc.workItems.remove(workItemId);
      if (!result.success) throw new Error(result.error.message);
      return workItemId;
    },
    onSuccess: (workItemId) => {
      queryClient.removeQueries({ queryKey: ['workItem', workItemId] });
      queryClient.removeQueries({ queryKey: ['sidebar', 'sessions', workItemId] });
      void queryClient.invalidateQueries({ queryKey: ['sidebar', 'summaries'] });
      // Prefix key: covers the shared local list and the notification owner-id
      // list, which are the only readers of `workItems.getAll`.
      void queryClient.invalidateQueries({ queryKey: ['workItems'] });
      // An adopted checkout outlives its work item and is offered again.
      void queryClient.invalidateQueries({ queryKey: WORKTREE_SOURCES_QUERY_KEY });
      onDeleted?.(workItemId);
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not delete work item',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const confirmDeleteWorkItem = useCallback(
    async (item: DeletableWorkItem) => {
      // An adopted checkout stays on Delete, and the confirm must say so.
      const lanes = await rpc.worktrees.list(item.id).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false as const, error: { type: 'worktree_error' as const, message } };
      });
      if (!lanes.success) {
        toast({
          title: 'Could not delete work item',
          description: `Could not read its branches: ${lanes.error.message}`,
          variant: 'destructive',
        });
        return;
      }
      const primary = lanes.data.worktrees.find((lane) => lane.isPrimary);
      const adopted =
        primary?.checkoutOrigin === 'adopted'
          ? { path: primary.path, branch: primary.branchName }
          : null;
      showConfirm({
        ...describeWorkItemDeleteConfirm({ name: item.name, adopted }),
        confirmLabel: 'Delete',
        variant: 'destructive',
        onSuccess: () => deleteMutation.mutate(item.id),
      });
    },
    [showConfirm, deleteMutation]
  );

  return { confirmDeleteWorkItem, isDeleting: deleteMutation.isPending };
}
