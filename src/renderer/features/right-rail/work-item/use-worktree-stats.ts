import { useQueries } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

/** Uncommitted totals and unpushed count per worktree, for the group headers. */
export function useWorktreeStats(workItemId: string, worktrees: { id: string }[]) {
  return useQueries({
    queries: worktrees.map((worktree) => ({
      queryKey: ['workItem', 'gitStatus', workItemId, worktree.id],
      queryFn: async () => {
        const result = await rpc.workItems.getGitStatus(workItemId, worktree.id);
        if (!result.success) throw new Error('Read file changes failed');
        return result.data.files;
      },
      refetchInterval: 15000,
    })),
    combine: (results) =>
      new Map(
        worktrees.map((worktree, index) => [
          worktree.id,
          results[index].data?.reduce(
            (totals, file) => ({
              added: totals.added + file.added,
              removed: totals.removed + file.removed,
              files: totals.files + 1,
            }),
            { added: 0, removed: 0, files: 0 }
          ) ?? null,
        ])
      ),
  });
}
