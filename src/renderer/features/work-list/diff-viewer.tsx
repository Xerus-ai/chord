import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { DiffContent } from './cloud-diff-content';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';
import { DiffBody } from './diff-body';
import { useWorkItemGit } from './use-work-item-git';

/** The owner's Undo All and Apply All for one file of the checkout. */
function LocalDiffActions({
  workItemId,
  worktreeId,
  filePath,
}: {
  workItemId: string;
  worktreeId: string | undefined;
  filePath: string;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshFileViews = useCallback(() => {
    setActionError(null);
    void queryClient.invalidateQueries({
      queryKey: ['workItem', 'gitStatus', workItemId, worktreeId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['workItem', 'fileDiff', workItemId, filePath, worktreeId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['workItem', 'fileContent', workItemId, filePath, worktreeId],
    });
  }, [queryClient, workItemId, filePath, worktreeId]);

  const applyMutation = useMutation({
    mutationFn: () => rpc.workItems.stageFile(workItemId, filePath, worktreeId),
    onSuccess: (result) => {
      if (!result.success) {
        setActionError(describeRpcFailure('Apply All', result.error));
        return;
      }
      refreshFileViews();
    },
    onError: (error) => setActionError(describeThrownFailure('Apply All', error)),
  });

  const undoMutation = useMutation({
    mutationFn: () => rpc.workItems.restoreFile(workItemId, filePath, worktreeId),
    onSuccess: (result) => {
      if (!result.success) {
        setActionError(describeRpcFailure('Undo All', result.error));
        return;
      }
      refreshFileViews();
    },
    onError: (error) => setActionError(describeThrownFailure('Undo All', error)),
  });

  const isBusy = applyMutation.isPending || undoMutation.isPending;

  return (
    <>
      {actionError && (
        <span
          role="alert"
          title={actionError}
          className="min-w-0 truncate text-tiny tracking-tiny text-status-err"
        >
          {actionError}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => undoMutation.mutate()}
          disabled={isBusy}
          title="Discard all changes"
          className="flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors duration-150 ease-out hover:bg-surface-inset hover:text-text disabled:cursor-not-allowed disabled:text-text-disabled"
        >
          {undoMutation.isPending ? (
            <Loader2 className="size-icon-xs animate-spin" />
          ) : (
            <RotateCcw className="size-icon-xs" />
          )}
          Undo All
        </button>
        <button
          onClick={() => applyMutation.mutate()}
          disabled={isBusy}
          title="Stage all changes"
          className="flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border-none bg-action-bg px-2 py-1 text-tiny tracking-tiny font-medium text-action-fg transition-colors duration-150 ease-out hover:bg-action-bg-hover disabled:cursor-not-allowed disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
        >
          {applyMutation.isPending ? (
            <Loader2 className="size-icon-xs animate-spin" />
          ) : (
            <CheckCheck className="size-icon-xs" />
          )}
          Apply All
        </button>
      </div>
    </>
  );
}

/**
 * The owner's diff of one checkout file. `worktreeId` picks the checkout;
 * omitted diffs the primary worktree.
 */
export function LocalDiff({
  workItemId,
  worktreeId,
  filePath,
}: {
  workItemId: string;
  worktreeId?: string;
  filePath: string;
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['workItem', 'fileDiff', workItemId, filePath, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.getFileDiff(workItemId, filePath, worktreeId);
      if (!result.success) throw new Error('Failed to load diff');
      return result.data;
    },
  });

  // The +N -N label reads the same gitStatus query the Undo/Apply actions
  // invalidate. A snapshot captured when the file was clicked would keep
  // claiming the old counts after "Undo All" reverted the file to HEAD.
  const { files } = useWorkItemGit(workItemId, worktreeId);
  const changed = files.find((f) => f.name === filePath);

  const content: DiffContent = isPending
    ? { kind: 'loading' }
    : error
      ? { kind: 'failed' }
      : {
          kind: 'ready',
          original: data.original,
          modified: data.modified,
          hideUnchangedRegions: false,
        };

  return (
    <DiffBody
      filePath={filePath}
      stats={{ added: changed?.added ?? 0, removed: changed?.removed ?? 0 }}
      content={content}
      actions={
        <LocalDiffActions workItemId={workItemId} worktreeId={worktreeId} filePath={filePath} />
      }
    />
  );
}
