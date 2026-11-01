import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { FullGitStatus, GitChange } from '@shared/git';
import { describeRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { rpc } from '@renderer/lib/ipc';

/**
 * The rail's git layer: one query per read, keyed by worktree id, so the five
 * panels share a cache entry instead of each polling the same checkout.
 *
 * `git.*` takes `(projectId, workspaceId)`. `resolveWorkspace` looks the
 * workspace up by `workspaceId` alone and `worktrees/workspace-bridge.ts`
 * registers each worktree under its own id, so `worktreeId` selects the
 * checkout; `projectId` is the key the bridge acquired it under and only main
 * can resolve it (`worktrees.getProjectId`), same as `commit-panel.tsx`.
 */
export function useWorktreeProject(worktreeId: string | null) {
  return useQuery({
    queryKey: ['worktrees', 'projectId', worktreeId],
    queryFn: async () => {
      const result = await rpc.worktrees.getProjectId(worktreeId as string);
      if (!result.success) throw new Error(describeRpcFailure('Resolve project', result.error));
      return result.data.projectId;
    },
    enabled: !!worktreeId,
    staleTime: Infinity,
  });
}

export interface WorktreeStatus extends FullGitStatus {
  conflicts: GitChange[];
}

/** Staged, unstaged, untracked and conflicted changes plus the branch, in one refresh. */
export function useWorktreeStatus(projectId: string | undefined, worktreeId: string | null) {
  const query = useQuery({
    queryKey: ['rail', 'git', 'fullStatus', worktreeId],
    queryFn: async () => {
      const result = await rpc.git.getFullStatus(projectId as string, worktreeId as string);
      if (!result.success) throw new Error(describeRpcFailure('Read changes', result.error));
      return result.data;
    },
    enabled: !!projectId && !!worktreeId,
    refetchInterval: 5000,
  });

  const status = useMemo<WorktreeStatus | null>(() => {
    if (!query.data) return null;
    const isConflict = (change: GitChange) => change.status === 'conflicted';
    return {
      ...query.data,
      staged: query.data.staged.filter((change) => !isConflict(change)),
      unstaged: query.data.unstaged.filter((change) => !isConflict(change)),
      conflicts: [...query.data.staged, ...query.data.unstaged].filter(isConflict),
    };
  }, [query.data]);

  return { status, isPending: query.isPending, error: query.error };
}

/** Commits on this worktree's branch, newest first, with how many are unpushed. */
export function useWorktreeLog(
  projectId: string | undefined,
  worktreeId: string | null,
  maxCount = 20
) {
  return useQuery({
    queryKey: ['rail', 'git', 'log', worktreeId, maxCount],
    queryFn: async () => {
      const result = await rpc.git.getLog(projectId as string, worktreeId as string, maxCount);
      if (!result.success) throw new Error(describeRpcFailure('Read commits', result.error));
      return result.data;
    },
    enabled: !!projectId && !!worktreeId,
    refetchInterval: 15000,
  });
}

/** The remote a worktree publishes to. No remote picker exists yet; git's default name. */
const DEFAULT_REMOTE = 'origin';

export type WorktreeGitAction =
  | { kind: 'stage'; filePath: string }
  | { kind: 'unstage'; filePath: string }
  | { kind: 'discard'; filePath: string }
  | { kind: 'stage-all' }
  | { kind: 'commit'; message: string }
  | { kind: 'push' }
  | { kind: 'pull' }
  | { kind: 'publish'; branchName: string };

async function runGitAction(
  projectId: string,
  worktreeId: string,
  action: WorktreeGitAction
): Promise<void> {
  const result = await (async () => {
    switch (action.kind) {
      case 'stage':
        return rpc.git.stageFile(projectId, worktreeId, action.filePath);
      case 'unstage':
        return rpc.git.unstageFile(projectId, worktreeId, action.filePath);
      case 'discard':
        return rpc.git.revertFile(projectId, worktreeId, action.filePath);
      case 'stage-all':
        return rpc.git.stageAllFiles(projectId, worktreeId);
      case 'commit':
        return rpc.git.commit(projectId, worktreeId, action.message);
      case 'push':
        return rpc.git.push(projectId, worktreeId, DEFAULT_REMOTE);
      case 'pull':
        return rpc.git.pull(projectId, worktreeId);
      case 'publish':
        return rpc.git.publishBranch(projectId, worktreeId, action.branchName, DEFAULT_REMOTE);
    }
  })();

  if (!result.success)
    throw new Error(describeRpcFailure(ACTION_LABELS[action.kind], result.error));
}

const ACTION_LABELS: Record<WorktreeGitAction['kind'], string> = {
  stage: 'Stage file',
  unstage: 'Unstage file',
  discard: 'Discard changes',
  'stage-all': 'Stage all changes',
  commit: 'Commit',
  push: 'Push',
  pull: 'Pull',
  publish: 'Publish branch',
};

/**
 * Every write the Source Control panel makes, with the invalidation each one
 * needs. Anything that rewrites the worktree stales the status, the log, and
 * every open diff or file tab reading that checkout — a stale diff after a
 * discard shows content the file no longer has.
 */
export function useWorktreeGitActions(
  projectId: string | undefined,
  worktreeId: string | null,
  workItemId: string
) {
  const queryClient = useQueryClient();

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rail', 'git'] }),
      queryClient.invalidateQueries({ queryKey: ['workItem', 'gitStatus', workItemId] }),
      queryClient.invalidateQueries({ queryKey: ['workItem', 'gitLog', workItemId] }),
      queryClient.invalidateQueries({ queryKey: ['workItem', 'fileDiff', workItemId] }),
      queryClient.invalidateQueries({ queryKey: ['workItem', 'fileContent', workItemId] }),
    ]);
  }, [queryClient, workItemId]);

  const mutation = useMutation({
    mutationFn: async (action: WorktreeGitAction) => {
      if (!projectId || !worktreeId) {
        throw new Error('This worktree has no checkout on this device');
      }
      await runGitAction(projectId, worktreeId, action);
    },
    onSuccess: invalidate,
  });

  return {
    run: mutation.mutate,
    runAsync: mutation.mutateAsync,
    pending: mutation.isPending,
    pendingAction: mutation.isPending ? (mutation.variables ?? null) : null,
    error: mutation.error instanceof Error ? mutation.error.message : null,
    reset: mutation.reset,
  };
}
