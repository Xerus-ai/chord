import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoIconChoice } from '@shared/repo-icons';
import { addExistingRepositoryFromFolder } from '@renderer/features/settings/create-repository';
import { useSetRepositoryArchived } from '@renderer/features/settings/use-archive-repository';
import { useLocalSharingAvailabilityOf } from '@renderer/features/sharing/use-local-sharing-availability';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { useInvalidateRepos, useRepos } from '@renderer/lib/hooks/use-repos';
import { useInvalidateWorkItems, useWorkItems } from '@renderer/lib/hooks/use-work-items';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useModalContext } from '@renderer/lib/modal/modal-provider';
import { SidebarRowSkeleton } from '@renderer/lib/ui/skeleton';
import type { RepoGroupActions } from './repo-group-menu';
import { buildRepoIdentityLookup } from './repo-identity-lookup';
import { SidebarCallout } from './sidebar-callout';
import { EmptySidebar } from './sidebar-empty';
import { SidebarFooter } from './sidebar-footer';
import { SidebarHeader } from './sidebar-header';
import { SidebarNewWorkItemButton } from './sidebar-new-work-item-button';
import { projectSidebar, type SidebarItem } from './sidebar-projection';
import { SectionHeader } from './sidebar-section';
import { SidebarTopBar } from './sidebar-top-bar';
import { SidebarGroupList, SidebarWorkItemList } from './sidebar-work-item-list';
import { useDeleteWorkItem } from './use-delete-work-item';
import { useDetectRepoIcon } from './use-detect-repo-icon';
import { useDiscoveredWorktrees } from './use-discovered-worktrees';
import { useLaneActions } from './use-lane-actions';
import { useLocalRepoByRemote } from './use-local-repo-by-remote';
import { useMarkWorkItemViewed } from './use-mark-work-item-viewed';
import { useNeedsYouPullRequests } from './use-needs-you-pull-requests';
import { useSharedWorkItems } from './use-shared-work-items';
import { useSidebarItems } from './use-sidebar-items';
import { useSidebarOpen } from './use-sidebar-open';
import { useSidebarSummaries } from './use-sidebar-summaries';
import { useSidebarViewState } from './use-sidebar-view-state';

/** Mod+1..9 jumps to the Nth row the user is actually looking at. */
const JUMP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const MODULE_LOAD_SECONDS = Math.floor(Date.now() / 1000);

/**
 * Render-pure clock for the projection's age-based filters. Minute steps —
 * the coarsest consumer is "hide idle over 7 days".
 */
function useNowSeconds(): number {
  const [nowSeconds, setNowSeconds] = useState(MODULE_LOAD_SECONDS);
  useEffect(() => {
    const id = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return nowSeconds;
}

export function AppSidebar({
  onOpenSearch,
  onToggleNotifications,
  hasUnreadNotifications,
}: {
  onOpenSearch: () => void;
  onToggleNotifications: () => void;
  hasUnreadNotifications: boolean;
}) {
  const { navigate } = useNavigate();
  const { showModal } = useModalContext();
  const { params } = useParams('work-list');
  const currentWorkItemId = (params as { workItemId?: string }).workItemId ?? null;
  useMarkWorkItemViewed(currentWorkItemId);

  const { items, isLoading: isLoadingItems, error: itemsError, refetchWorkItems } = useWorkItems();
  const invalidateWorkItems = useInvalidateWorkItems();
  const { sharedItems, artifactsOnlyItems } = useSharedWorkItems();
  const { localRepoByRemote, error: repoRemotesError } = useLocalRepoByRemote();
  const localSharingAvailabilityOf = useLocalSharingAvailabilityOf();
  const { pullRequests } = useNeedsYouPullRequests();
  const { repos: repoRecords } = useRepos();
  const invalidateRepos = useInvalidateRepos();
  const { setRepositoryArchived } = useSetRepositoryArchived();
  const { detectRepoIcon, detectingRepoId } = useDetectRepoIcon();
  const {
    view,
    options,
    pinnedIds,
    expandedItemIds,
    setView,
    setOptions,
    togglePinned,
    toggleExpanded,
  } = useSidebarViewState();

  // Every summary costs a git diff, so a done item's is fetched only once its
  // row can be seen: always in Repo view, where done rows sit in their repo
  // group, and in Status view only once the collapsed Done band is opened.
  const [doneBandOpen, setDoneBandOpen] = useState(false);
  const showsDoneRows = view === 'repo' || doneBandOpen;
  const summaryItemIds = useMemo(
    () => items.filter((item) => showsDoneRows || item.status !== 'done').map((item) => item.id),
    [items, showsDoneRows]
  );
  const {
    summaryMap,
    runningIds,
    runningSeedError,
    error: summariesError,
  } = useSidebarSummaries(summaryItemIds);

  const { sidebarItems, setReadState } = useSidebarItems({
    items,
    sharedItems,
    artifactsOnlyItems,
    localRepoByRemote,
    summaryMap,
    runningIds,
    pullRequests,
  });

  const nowSeconds = useNowSeconds();

  const projection = useMemo(
    () =>
      projectSidebar({
        items: sidebarItems,
        pinnedIds,
        options,
        view,
        nowSeconds,
      }),
    [sidebarItems, pinnedIds, options, view, nowSeconds]
  );

  /** The order on screen, top to bottom — what cycling and Mod+1..9 walk. */
  const visibleOrder = useMemo(
    () => [...projection.pinned, ...projection.groups.flatMap((group) => group.items)],
    [projection]
  );

  /** Mod+1..9 reaches the first nine rows only, so only those wear a hint. */
  const jumpIndexById = useMemo(() => {
    const byId = new Map<string, number>();
    visibleOrder.slice(0, JUMP_KEYS.length).forEach((item, index) => byId.set(item.id, index + 1));
    return byId;
  }, [visibleOrder]);

  const repos = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of sidebarItems) byId.set(item.repoId, item.repoLabel);
    return [...byId.entries()].map(([id, label]) => ({ id, label }));
  }, [sidebarItems]);

  /**
   * The repo ROWS, keyed by id. A sidebar group's key is only a local repo id
   * for the user's own items, so this is also what tells a repo group apart
   * from a teammate's repo name or the `'no-repo'` group.
   */
  const repoIdentities = useMemo(() => buildRepoIdentityLookup(repoRecords), [repoRecords]);

  const { openWorkItem, openRow, openArtifact } = useSidebarOpen({
    artifactsOnlyItems,
    toggleExpanded,
  });

  const { groups, discovered } = useDiscoveredWorktrees({
    groups: projection.groups,
    view,
    repos: repoRecords,
    visibleRepoIds: options.visibleRepoIds,
    openWorkItem,
  });

  const handleNewWorkItem = useCallback(() => {
    showModal('createWorkItemDialog', {
      onSuccess: (result: { id: string }) => {
        invalidateWorkItems();
        openWorkItem(result.id);
      },
    });
  }, [showModal, invalidateWorkItems, openWorkItem]);

  const handleNewWorkItemInRepo = useCallback(
    (repoId: string) => {
      showModal('createWorkItemDialog', {
        initialRepoId: repoId,
        onSuccess: (result: { id: string }) => {
          invalidateWorkItems();
          openWorkItem(result.id);
        },
      });
    },
    [showModal, invalidateWorkItems, openWorkItem]
  );

  /**
   * The repo header's `···`. Repository settings opens that repository's own
   * page through the view params the settings panel reads (`settings-view.tsx`).
   */
  const repoActions = useMemo<RepoGroupActions>(
    () => ({
      onNewWorkItem: handleNewWorkItemInRepo,
      onOpenRepositorySettings: (repoId: string) =>
        navigate('settings', { tab: 'repository', card: undefined, repoId }),
      onChooseIcon: (repoId: string, icon: RepoIconChoice) => {
        void rpc.repos.setIcon({ id: repoId, icon }).then(invalidateRepos);
      },
      onDetectIcon: detectRepoIcon,
      detectingRepoId,
      onArchive: (repoId: string) => void setRepositoryArchived(repoId, true),
    }),
    [
      handleNewWorkItemInRepo,
      navigate,
      invalidateRepos,
      detectRepoIcon,
      detectingRepoId,
      setRepositoryArchived,
    ]
  );

  useEffect(() => {
    const handler = () => handleNewWorkItem();
    window.addEventListener('chord:create-work-item', handler);
    return () => window.removeEventListener('chord:create-work-item', handler);
  }, [handleNewWorkItem]);

  // Cycling walks the rendered order rather than a sort of its own, so the
  // key and the eye agree even under a non-default Sort by.
  useEffect(() => {
    const handler = (event: Event) => {
      const direction = (event as CustomEvent<'next' | 'prev'>).detail;
      if (visibleOrder.length === 0) return;
      const current = visibleOrder.findIndex((item) => item.id === currentWorkItemId);
      const step = direction === 'next' ? 1 : -1;
      const target =
        current === -1
          ? direction === 'next'
            ? 0
            : visibleOrder.length - 1
          : (current + step + visibleOrder.length) % visibleOrder.length;
      openWorkItem(visibleOrder[target].id);
    };
    window.addEventListener('chord:cycle-work-item', handler);
    return () => window.removeEventListener('chord:cycle-work-item', handler);
  }, [visibleOrder, currentWorkItemId, openWorkItem]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      const index = JUMP_KEYS.indexOf(event.key);
      if (index === -1) return;
      const target = visibleOrder[index];
      if (!target) return;
      event.preventDefault();
      openWorkItem(target.id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleOrder, openWorkItem]);

  const handleWorkItemDeleted = useCallback(
    (deletedId: string) => {
      if (deletedId === currentWorkItemId) navigate('home');
    },
    [currentWorkItemId, navigate]
  );
  const { confirmDeleteWorkItem } = useDeleteWorkItem(handleWorkItemDeleted);
  const laneActions = useLaneActions(openWorkItem);

  const actions = useMemo(
    () => ({
      onOpen: openRow,
      onTogglePinned: togglePinned,
      onToggleExpanded: toggleExpanded,
      onSetReadState: (workItemId: string, read: boolean) => void setReadState(workItemId, read),
      onCopyBranch: (branchName: string) => void navigator.clipboard.writeText(branchName),
      onMarkDone: (workItemId: string) => {
        void rpc.workItems.update({ id: workItemId, status: 'done' }).then(invalidateWorkItems);
      },
      onShare: (item: SidebarItem) =>
        showModal('shareModal', { workItemId: item.id, workItemName: item.name }),
      // The menu offers Share on this machine's own rows only.
      shareAvailability: (item: SidebarItem) => {
        const row = items.find((local) => local.id === item.id);
        if (!row) throw new Error(`Share asked for ${item.id}, which is not a local work item`);
        return localSharingAvailabilityOf(row);
      },
      onDelete: (workItemId: string) => {
        const row = items.find((item) => item.id === workItemId);
        if (row) void confirmDeleteWorkItem(row);
      },
      ...laneActions,
      onFocusSession: (workItemId: string, sessionId: string) => {
        openWorkItem(workItemId);
        openCenterTab(workItemId, { kind: 'session', sessionId });
      },
      onOpenArtifact: openArtifact,
    }),
    [
      laneActions,
      openWorkItem,
      openRow,
      openArtifact,
      togglePinned,
      toggleExpanded,
      setReadState,
      invalidateWorkItems,
      showModal,
      items,
      confirmDeleteWorkItem,
      localSharingAvailabilityOf,
    ]
  );

  const listProps = {
    options,
    view,
    activeWorkItemId: currentWorkItemId,
    expandedItemIds,
    pinnedIds,
    summaryMap,
    jumpIndexById,
    repoIdentities,
    actions,
  };

  const isEmpty = projection.pinned.length === 0 && groups.length === 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-canvas">
      <SidebarTopBar
        onOpenSearch={onOpenSearch}
        onToggleNotifications={onToggleNotifications}
        hasUnreadNotifications={hasUnreadNotifications}
      />
      <SidebarNewWorkItemButton onClick={handleNewWorkItem} />
      <SidebarHeader
        view={view}
        onViewChange={setView}
        options={options}
        repos={repos}
        onOptionsChange={setOptions}
        onAddRepo={() => void addExistingRepositoryFromFolder()}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-0.5">
        {itemsError ? (
          <SidebarCallout
            variant="error"
            title="Could not load your work items"
            description={itemsError instanceof Error ? itemsError.message : String(itemsError)}
            actions={[{ label: 'Try again', onClick: () => void refetchWorkItems() }]}
          />
        ) : isLoadingItems && items.length === 0 ? (
          <div className="mt-2 flex flex-col gap-1">
            <SidebarRowSkeleton />
            <SidebarRowSkeleton />
            <SidebarRowSkeleton />
          </div>
        ) : (
          <>
            {summariesError && (
              <p className="px-3 py-1 text-tiny tracking-tiny text-status-err">
                Branch stats unavailable
              </p>
            )}
            {repoRemotesError && (
              <p className="px-3 py-1 text-tiny tracking-tiny text-status-err">
                Repo matching for shared items unavailable
              </p>
            )}
            {runningSeedError && (
              <p className="px-3 py-1 text-tiny tracking-tiny text-status-err">
                Agent status unavailable
              </p>
            )}

            {projection.pinned.length > 0 && (
              <>
                <SectionHeader label="Pinned" count={projection.pinned.length} />
                <SidebarWorkItemList {...listProps} items={projection.pinned} />
              </>
            )}

            <SidebarGroupList
              {...listProps}
              groups={groups}
              discovered={discovered}
              repoActions={repoActions}
              onDoneOpenChange={setDoneBandOpen}
            />

            {!isLoadingItems && isEmpty && <EmptySidebar hasItems={sidebarItems.length > 0} />}
          </>
        )}
      </div>

      <SidebarFooter />
    </div>
  );
}
