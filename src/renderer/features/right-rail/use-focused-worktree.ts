import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Worktree } from '@shared/worktrees';
import { getFocusedPane } from '@renderer/features/work-list/center-layout';
import { useCenterLayout } from '@renderer/features/work-list/center-tabs-store';
import { useWorkItemWorktrees } from '@renderer/features/work-list/use-work-item-worktrees';
import { rpc } from '@renderer/lib/ipc';

/** The work item's live worktrees, primary first (`worktrees.list` order). */
export function useLiveWorktrees(workItemId: string): Worktree[] {
  const worktrees = useWorkItemWorktrees(workItemId);
  return useMemo(
    () => (worktrees ?? []).filter((worktree) => worktree.archivedAt === null),
    [worktrees]
  );
}

/**
 * Which worktree the rail is looking at: the one behind the focused pane's
 * active tab, falling back to the primary.
 *
 * This is the selector the design's "panels react to the focused worktree"
 * rule is built on. The rail passes the result down through `RailScope`, so a
 * worktree change re-renders the panels and re-keys their queries without
 * remounting anything — a panel keyed by worktree id would refire every query
 * it owns on each tab switch.
 */
export function useFocusedWorktreeId(workItemId: string, layoutKey: string): string | null {
  const { layout } = useCenterLayout(layoutKey);
  const active = getFocusedPane(layout).active;
  const live = useLiveWorktrees(workItemId);

  const { data: sessions } = useQuery({
    queryKey: ['agentSessions', workItemId],
    queryFn: async () => (await rpc.agentSessions.getAll(workItemId)).data.sessions,
    refetchInterval: 5000,
  });

  return useMemo(() => {
    const primaryId = live.find((worktree) => worktree.isPrimary)?.id ?? live[0]?.id ?? null;
    const isLive = (id: string | null | undefined): id is string =>
      !!id && live.some((worktree) => worktree.id === id);

    if (active === null) return primaryId;
    if (active.kind === 'session') {
      const session = (sessions ?? []).find((row) => row.id === active.sessionId);
      return isLive(session?.worktreeId) ? session.worktreeId : primaryId;
    }
    if (active.kind === 'path' || active.kind === 'commit') {
      if (isLive(active.worktreeId)) return active.worktreeId;
    }
    return primaryId;
  }, [active, sessions, live]);
}
