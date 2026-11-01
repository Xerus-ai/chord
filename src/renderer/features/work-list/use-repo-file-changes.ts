import { useEffect, useId, useRef } from 'react';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { useWorktreeProject } from '@renderer/features/right-rail/use-worktree-git';
import { events, rpc } from '@renderer/lib/ipc';
import { touchesRepoFile } from './repo-file-change';
import { useWorkItemWorktrees } from './use-work-item-worktrees';

/**
 * Calls `onChange` when a repo file changes on disk while its Preview is
 * shown (S9): an editor, a checkout, a script. It holds the worktree watcher
 * the Files panel uses, under a label of its own, so neither stops the
 * other's watch.
 */
export function useRepoFileChanges({
  workItemId,
  worktreeId,
  filePath,
  onChange,
}: {
  workItemId: string;
  /** Undefined: the primary worktree. */
  worktreeId: string | undefined;
  filePath: string;
  onChange: () => void;
}): void {
  const worktrees = useWorkItemWorktrees(workItemId);
  const id = worktreeId ?? worktrees?.find((worktree) => worktree.isPrimary)?.id ?? null;
  const projectId = useWorktreeProject(id).data ?? null;
  const label = `preview:${useId()}`;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!projectId || !id) return;
    const directory = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
    void rpc.fs.watchSetPaths(projectId, id, [directory], label).then((result) => {
      if (!result.success) {
        console.error(`[repo-preview] watching ${filePath} failed: ${result.error.type}`);
      }
    });
    const stopListening = events.on(fsWatchEventChannel, (event) => {
      if (event.workspaceId === id && touchesRepoFile(event.events, filePath)) {
        onChangeRef.current();
      }
    });
    return () => {
      stopListening();
      void rpc.fs.watchStop(projectId, id, label);
    };
  }, [projectId, id, filePath, label]);
}
