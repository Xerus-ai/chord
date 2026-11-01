import { useCallback } from 'react';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { describeThrownFailure } from './describe-action-failure';
import { useCommitAndPush } from './use-commit-and-push';

/** Git actions the command palette dispatches at the focused work item. */
export type GitAction = 'commit' | 'push' | 'create-pr';

export function isGitAction(value: string): value is GitAction {
  return value === 'commit' || value === 'push' || value === 'create-pr';
}

function reportFailure(action: string, message: string): void {
  toast({ title: `${action} failed`, description: message, variant: 'destructive' });
}

/**
 * Runs the git actions the palette and the band dispatch at the open work
 * item. Create PR opens the form for the focused lane (`worktreeId`): a PR is
 * opened from a lane's branch into its target, never from "the work item".
 * Every failure is reported — these used to be `.catch(() => {})`, so a
 * rejected push or a missing remote looked exactly like success.
 */
export function useGitActions(item: WorkItemRow, worktreeId: string | null) {
  const runCommitAndPush = useCommitAndPush();
  const showCreatePr = useShowModal('createPrModal');

  return useCallback(
    async (action: GitAction) => {
      if (action === 'create-pr') {
        if (worktreeId === null) {
          reportFailure('Create pull request', 'No branch of this work item is open yet.');
          return;
        }
        showCreatePr({ workItemId: item.id, workItemName: item.name, worktreeId });
        return;
      }
      try {
        // The palette has no inline surface, so its failures become toasts.
        const failure = await runCommitAndPush(item.id, item.name);
        if (failure) reportFailure('Commit and push', failure);
      } catch (error) {
        reportFailure('Commit and push', describeThrownFailure('Git action', error));
      }
    },
    [item, worktreeId, runCommitAndPush, showCreatePr]
  );
}
