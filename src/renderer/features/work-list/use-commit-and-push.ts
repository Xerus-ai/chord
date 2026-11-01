import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';

/**
 * Stage everything, commit, and publish the branch.
 *
 * Three surfaces run this — the command palette, the changes panel, and the
 * composer's Accept edits — and each carried its own copy. Only the palette's
 * confirmed success, so committing from the other two ended with the spinner
 * stopping and nothing else, which is what a no-op also looks like. The
 * composer's copy additionally refreshed no views, so the changes panel went on
 * listing files that were already committed until something else refetched.
 */

/** Everything a commit rewrites: the file list, and every open diff or file tab. */
export async function invalidateWorktreeViews(
  queryClient: QueryClient,
  workItemId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['workItem', 'gitStatus', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['workItem', 'gitLog', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['workItem', 'fileDiff', workItemId] }),
    queryClient.invalidateQueries({ queryKey: ['workItem', 'fileContent', workItemId] }),
    // The rail reads each lane's git state through `rpc.git.*` under its own keys.
    queryClient.invalidateQueries({ queryKey: ['rail', 'git'] }),
  ]);
}

/**
 * Commits and refreshes, without saying anything to the user.
 *
 * Returns the failure description, or `null` on success. Reporting is left to
 * the caller in both directions: the create-PR flow commits as one step of
 * something larger and must not announce it, while the panel and the composer
 * show failures inline beside the message the user still has rather than in a
 * toast that leaves on its own.
 *
 * `worktreeId` names the lane to commit in; omitted, the primary's checkout.
 */
export async function commitAndPushWorkItem(
  workItemId: string,
  commitMessage: string,
  queryClient: QueryClient,
  worktreeId?: string
): Promise<string | null> {
  try {
    const result = await rpc.workItems.commitAndPush(workItemId, commitMessage, worktreeId);
    if (!result.success) return describeRpcFailure('Commit and push', result.error);
    await invalidateWorktreeViews(queryClient, workItemId);
    return null;
  } catch (error) {
    return describeThrownFailure('Commit and push', error);
  }
}

/**
 * The user-facing action: commit, refresh, and confirm it happened.
 *
 * Resolves to the failure description, or `null` on success.
 */
export function useCommitAndPush(): (
  workItemId: string,
  commitMessage: string
) => Promise<string | null> {
  const queryClient = useQueryClient();

  return useCallback(
    async (workItemId: string, commitMessage: string) => {
      const failure = await commitAndPushWorkItem(workItemId, commitMessage, queryClient);
      if (!failure) {
        toast({ title: 'Committed and pushed', description: commitMessage });
      }
      return failure;
    },
    [queryClient]
  );
}
