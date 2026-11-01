import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { NeedsYouPullRequests, SidebarSummary } from '@shared/sidebar-summaries';
import type { SidebarLastViewedAtSnapshot } from '@shared/view-state';
import { isOwnedByAnotherAccount } from '@shared/work-item-ownership';
import type { WorkItemStatusBucket } from '@shared/work-item-status';
import type { WorkItemRow } from '@main/db/schema-work-items';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { mergePullRequestReasons } from './needs-you-pull-request-reasons';
import { resolveItemCompareCue, resolveItemProviderId } from './row-presentation';
import {
  repoIdentity,
  toArtifactsOnlySidebarItem,
  toSharedSidebarItem,
  type LocalRepoByRemote,
} from './shared-sidebar-items';
import type { SidebarItem } from './sidebar-projection';

const LAST_VIEWED_AT_KEY = 'sidebar.lastViewedAt';
const LAST_VIEWED_QUERY_KEY = ['sidebar', 'lastViewedAt'] as const;

/**
 * The bucket the row actually shows. `aggregateBucket` is computed in main
 * and arrives on a 10s poll; the live turn-stream store knows within a frame
 * that an agent started. The live signal only ever promotes an idle or ready
 * row to `working` — it must not override a row that is blocked or failed,
 * which are the two states the user is being asked to act on.
 */
function resolveBucket(
  summaryBucket: WorkItemStatusBucket | null,
  isRunning: boolean,
  isDone: boolean
): WorkItemStatusBucket {
  if (isDone) return 'done';
  const bucket = summaryBucket ?? 'idle';
  if (!isRunning) return bucket;
  return bucket === 'idle' || bucket === 'ready_to_review' ? 'working' : bucket;
}

function toSidebarItem(
  item: WorkItemRow,
  summary: SidebarSummary | undefined,
  isRunning: boolean,
  pullRequests: NeedsYouPullRequests | undefined,
  lastViewedAt: SidebarLastViewedAtSnapshot,
  currentUserId: string | null
): SidebarItem {
  const prUrl = summary?.pullRequest?.url ?? item.prUrl;
  const lastFinishedTurnAt = summary?.lastFinishedTurnAt ?? null;
  return {
    id: item.id,
    name: item.name,
    ...repoIdentity(item.repoId, item.repoAlias),
    branchName: item.branchName,
    bucket: resolveBucket(summary?.aggregateBucket ?? null, isRunning, item.status === 'done'),
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    ownership: 'mine',
    owner: null,
    sharedArtifacts: null,
    diffStats: summary?.diffStats ?? null,
    pullRequestUrl: prUrl,
    pullRequest: summary?.pullRequest ?? null,
    providerId: resolveItemProviderId(summary),
    devServerUrl: summary?.devServerUrl ?? null,
    worktreeCount: summary?.worktrees.length ?? 1,
    liveSessionCount: summary?.worktrees.reduce((n, w) => n + w.liveSessions.length, 0) ?? 0,
    needsYou: mergePullRequestReasons(summary?.needsYou ?? [], prUrl, pullRequests),
    // No entry means the item has never been opened, so any finished turn is
    // unread — the same rule main applies when deriving `ready_to_review`.
    unread: lastFinishedTurnAt !== null && lastFinishedTurnAt > (lastViewedAt[item.id] ?? 0),
    provisionStatus: item.provisionStatus,
    ownedByAnotherAccount: isOwnedByAnotherAccount(item.ownerAccountId, currentUserId),
    // The user's own repo: its group's name is theirs, never suffixed.
    repoHint: null,
    compareCue: resolveItemCompareCue(summary),
  };
}

interface BuildSidebarItemsArgs {
  items: readonly WorkItemRow[];
  sharedItems: readonly CloudWorkItem[];
  artifactsOnlyItems: readonly ArtifactsOnlyWorkItem[];
  /** Where a teammate's item joins the user's own repo groups (`useLocalRepoByRemote`). */
  localRepoByRemote: LocalRepoByRemote;
  summaryMap: Map<string, SidebarSummary>;
  runningIds: ReadonlySet<string>;
  pullRequests: NeedsYouPullRequests | undefined;
}

/**
 * Flattens every source the sidebar reads into the one shape `projectSidebar`
 * consumes, and exposes the read/unread writes that share its storage key.
 */
export function useSidebarItems({
  items,
  sharedItems,
  artifactsOnlyItems,
  localRepoByRemote,
  summaryMap,
  runningIds,
  pullRequests,
}: BuildSidebarItemsArgs) {
  const queryClient = useQueryClient();

  const { data: lastViewedAt } = useQuery({
    queryKey: LAST_VIEWED_QUERY_KEY,
    queryFn: async () =>
      ((await rpc.viewState.get(LAST_VIEWED_AT_KEY)) ?? {}) as SidebarLastViewedAtSnapshot,
    staleTime: 5000,
  });

  const viewed = useMemo(() => lastViewedAt ?? {}, [lastViewedAt]);
  const currentUserId = useAccountSession().data?.user?.userId ?? null;

  const sidebarItems = useMemo(
    () => [
      ...items.map((item) =>
        toSidebarItem(
          item,
          summaryMap.get(item.id),
          runningIds.has(item.id),
          pullRequests,
          viewed,
          currentUserId
        )
      ),
      ...sharedItems.map((item) => toSharedSidebarItem(item, localRepoByRemote, pullRequests)),
      ...artifactsOnlyItems.map((item) => toArtifactsOnlySidebarItem(item, localRepoByRemote)),
    ],
    [
      items,
      sharedItems,
      artifactsOnlyItems,
      localRepoByRemote,
      summaryMap,
      runningIds,
      pullRequests,
      viewed,
      currentUserId,
    ]
  );

  /**
   * Mark read stamps now; mark unread stamps zero, which is the same state as
   * an item that was never opened — the one value that cannot be mistaken for
   * a real visit and cannot drift ahead of a future turn.
   */
  const setReadState = useCallback(
    async (workItemId: string, read: boolean) => {
      const current = ((await rpc.viewState.get(LAST_VIEWED_AT_KEY)) ??
        {}) as SidebarLastViewedAtSnapshot;
      const next = { ...current, [workItemId]: read ? Math.floor(Date.now() / 1000) : 0 };
      await rpc.viewState.save(LAST_VIEWED_AT_KEY, next);
      queryClient.setQueryData(LAST_VIEWED_QUERY_KEY, next);
      await queryClient.invalidateQueries({ queryKey: ['sidebar', 'summaries'] });
    },
    [queryClient]
  );

  return { sidebarItems, setReadState };
}
