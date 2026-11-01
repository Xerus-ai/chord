import { useMemo } from 'react';
import type {
  DiscoveredWorktree,
  RepoWorktreeSources,
  RepoWorktreeSourcesFailure,
} from '@shared/worktree-sources';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useInvalidateWorkItems } from '@renderer/lib/hooks/use-work-items';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import type { DiscoveredWorktreeActions } from './discovered-worktree-rows';
import type { SidebarGroup, SidebarView } from './sidebar-projection';
import { useInvalidateWorktreeSources, useWorktreeSources } from './use-worktree-sources';
import { appendDiscoveredRepoGroups } from './worktree-sources-model';

export interface DiscoveredWorktreesProps {
  sourcesByRepo: ReadonlyMap<string, RepoWorktreeSources>;
  failuresByRepo: ReadonlyMap<string, RepoWorktreeSourcesFailure>;
  actions: DiscoveredWorktreeActions;
}

/**
 * The left rail's share of plan §Phase 3 slice 6: each repository's
 * checkouts Chord did not make, the groups for repositories that have only
 * those, and Adopt / "Hide for this repo".
 */
export function useDiscoveredWorktrees(args: {
  groups: readonly SidebarGroup[];
  view: SidebarView;
  repos: readonly { id: string; alias: string }[];
  visibleRepoIds: readonly string[];
  openWorkItem: (workItemId: string) => void;
}): { groups: SidebarGroup[]; discovered: DiscoveredWorktreesProps } {
  const { groups, view, repos, visibleRepoIds, openWorkItem } = args;
  const repoIds = useMemo(() => repos.map((repo) => repo.id), [repos]);
  const { sources, failures } = useWorktreeSources(repoIds);
  const invalidateSources = useInvalidateWorktreeSources();
  const invalidateWorkItems = useInvalidateWorkItems();
  const showAdopt = useShowModal('adoptWorktreeDialog');

  const allGroups = useMemo(
    () =>
      view === 'repo'
        ? appendDiscoveredRepoGroups({ groups, sources, repos, visibleRepoIds })
        : [...groups],
    [groups, view, sources, repos, visibleRepoIds]
  );

  const discovered = useMemo<DiscoveredWorktreesProps>(
    () => ({
      sourcesByRepo: new Map(sources.map((entry) => [entry.repoId, entry])),
      failuresByRepo: new Map(failures.map((failure) => [failure.repoId, failure])),
      actions: {
        onAdopt: (repoId: string, worktree: DiscoveredWorktree) =>
          showAdopt({
            repoId,
            worktree,
            onSuccess: ({ workItemId, sessionId }) => {
              invalidateSources();
              invalidateWorkItems();
              openWorkItem(workItemId);
              // The imported conversation, as Import opens it (slice 5).
              if (sessionId) openCenterTab(workItemId, { kind: 'session', sessionId });
            },
          }),
        onHideReview: (repoId: string) => {
          rpc.worktreeSources
            .hideReview(repoId)
            .then(invalidateSources)
            .catch((error: unknown) =>
              toast({
                title: 'Could not hide these worktrees',
                description: error instanceof Error ? error.message : String(error),
                variant: 'destructive',
              })
            );
        },
      },
    }),
    [sources, failures, showAdopt, invalidateSources, invalidateWorkItems, openWorkItem]
  );

  return { groups: allGroups, discovered };
}
