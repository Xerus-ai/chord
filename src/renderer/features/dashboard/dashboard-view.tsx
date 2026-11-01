import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// The summaries query is keyed by the id list it is given, so asking for the
// same active items the sidebar asks for reads its cache rather than paying for
// a second round of git diffs.
import { buildRepoIdentityLookup } from '@renderer/features/app-sidebar/repo-identity-lookup';
import { useNeedsYouPullRequests } from '@renderer/features/app-sidebar/use-needs-you-pull-requests';
import { useSidebarItems } from '@renderer/features/app-sidebar/use-sidebar-items';
import { useSidebarSummaries } from '@renderer/features/app-sidebar/use-sidebar-summaries';
import {
  buildStatSegments,
  countMergedSince,
  sectionDashboardItems,
  selectReviewRequests,
} from '@renderer/features/dashboard/dashboard-projection';
import {
  CardSkeletons,
  CompletedItem,
  DashboardSection,
  InlineNotice,
  NoWorkItemsState,
} from '@renderer/features/dashboard/dashboard-sections';
import { DashboardWork } from '@renderer/features/dashboard/dashboard-work';
import { GreetingHeader, useCurrentMinute } from '@renderer/features/dashboard/greeting-header';
import {
  isSetupComplete,
  SetupChecklist,
  type ChecklistEntry,
  type SetupState,
} from '@renderer/features/dashboard/setup-checklist';
import {
  TeamPulseSidebar,
  type TeamPresenceStatus,
} from '@renderer/features/dashboard/team-pulse-sidebar';
import {
  useDashboardLinks,
  useParticipantRosters,
} from '@renderer/features/dashboard/use-dashboard-data';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { CreateWorkItemInput } from '@renderer/features/work-list/create-work-item-input';
import { describeLoadError } from '@renderer/lib/components/load-error-notice';
import { useRepos } from '@renderer/lib/hooks/use-repos';
import { useInvalidateWorkItems, useWorkItems } from '@renderer/lib/hooks/use-work-items';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { sortByRecentlyUpdated, sortByUrgency } from '@renderer/lib/work-item-order';

/** "Recently completed" is a glance, not an archive — the sidebar holds the rest. */
const COMPLETED_LIMIT = 5;

const MERGED_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/** The dashboard lists the user's own work; teammates' items live in the sidebar. */
const NO_SHARED_ITEMS: [] = [];
const NO_REPO_REMOTES = new Map<string, { repoId: string; alias: string }>();

type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

type AccountSession = Awaited<ReturnType<typeof rpc.account.getSession>>;

function DashboardTitlebar() {
  return null;
}

function DashboardMainPanel() {
  const { navigate } = useNavigate();
  const {
    authenticated: githubAuthenticated,
    isInitialized: githubStatusKnown,
    isLoading: githubStatusLoading,
    handleGithubConnect,
    checkStatus: fetchGithubStatus,
  } = useGithubContext();
  const inputAreaRef = useRef<HTMLInputElement>(null);
  const invalidateWorkItems = useInvalidateWorkItems();
  // Reads the one shared work-item cache rather than keeping a private copy.
  // A private copy is what let an item created in the sidebar stay missing from
  // this list until the view remounted — and it is why the two lists could be
  // in different orders at the same time.
  const {
    items,
    isFetched: workItemsFetched,
    error: workItemsQueryError,
    refetchWorkItems,
  } = useWorkItems();
  const [session, setSession] = useState<Loadable<AccountSession>>({ status: 'loading' });
  const [githubRetryError, setGithubRetryError] = useState<string | null>(null);
  const [teamStatus, setTeamStatus] = useState<TeamPresenceStatus | null>(null);

  const loadSession = useCallback(() => {
    rpc.account
      .getSession()
      .then((state) => setSession({ status: 'ready', data: state }))
      .catch((error: unknown) =>
        setSession({ status: 'error', message: describeLoadError(error) })
      );
  }, []);

  const retryWorkItems = useCallback(() => {
    void refetchWorkItems();
  }, [refetchWorkItems]);

  const retrySession = useCallback(() => {
    setSession({ status: 'loading' });
    loadSession();
  }, [loadSession]);

  const retryGithubStatus = useCallback(() => {
    setGithubRetryError(null);
    fetchGithubStatus().catch((error: unknown) => setGithubRetryError(describeLoadError(error)));
  }, [fetchGithubStatus]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const user = session.status === 'ready' ? session.data.user : null;
  const orgId = user?.orgId ?? null;
  const userName = user?.username?.split(' ')[0] ?? null;

  const workItemsError = workItemsQueryError ? describeLoadError(workItemsQueryError) : null;
  const workItemsLoaded = workItemsFetched && !workItemsError;

  const activeItems = useMemo(() => items.filter((i) => i.status !== 'done'), [items]);
  const activeItemIds = useMemo(() => activeItems.map((i) => i.id), [activeItems]);
  const {
    summaryMap,
    runningIds,
    isPending: summariesPending,
  } = useSidebarSummaries(activeItemIds);
  const {
    pullRequests,
    failed: reviewRequestsFailed,
    retry: retryReviewRequests,
  } = useNeedsYouPullRequests();
  const { links, error: linksError, retry: retryLinks } = useDashboardLinks(activeItemIds);
  const rosters = useParticipantRosters();
  const { repos } = useRepos();
  const repoIdentities = useMemo(() => buildRepoIdentityLookup(repos), [repos]);
  const createdWithProvider = useMemo(
    () => new Map(activeItems.map((item) => [item.id, item.agentProvider])),
    [activeItems]
  );

  // Same order as the sidebar, which is on screen beside this list.
  const sortedActiveItems = useMemo(
    () =>
      sortByUrgency(activeItems, (item) => ({
        pullRequestState: summaryMap.get(item.id)?.pullRequest?.state ?? null,
        isRunning: runningIds.has(item.id),
      })),
    [activeItems, summaryMap, runningIds]
  );

  const now = useCurrentMinute();
  const { sidebarItems } = useSidebarItems({
    items: sortedActiveItems,
    sharedItems: NO_SHARED_ITEMS,
    artifactsOnlyItems: NO_SHARED_ITEMS,
    localRepoByRemote: NO_REPO_REMOTES,
    summaryMap,
    runningIds,
    pullRequests,
  });
  const sections = useMemo(() => sectionDashboardItems(sidebarItems), [sidebarItems]);
  const reviewRequests = useMemo(
    () => selectReviewRequests(pullRequests?.reviewRequested, sidebarItems),
    [pullRequests, sidebarItems]
  );

  // Needs-you and running counts come from the summaries; until they land the
  // line waits rather than printing an item total with the signals missing.
  const stats =
    !workItemsLoaded || (activeItems.length > 0 && summariesPending)
      ? null
      : buildStatSegments({
          active: activeItems.length,
          needYou: sections.needsYou.length + reviewRequests.length,
          running: sections.running.length,
          mergedThisWeek: countMergedSince(
            items,
            Math.floor(now.getTime() / 1000) - MERGED_WINDOW_SECONDS
          ),
        });

  // "Recently completed" rendered every done item there had ever been, in
  // creation order — so the oldest finished work sat at the top of a list
  // that grows without bound.
  const recentlyCompleted = useMemo(
    () => sortByRecentlyUpdated(items.filter((i) => i.status === 'done')).slice(0, COMPLETED_LIMIT),
    [items]
  );

  const signedInEntry: ChecklistEntry =
    session.status === 'error'
      ? {
          state: 'unknown',
          unknownNote: `Couldn't read your account: ${session.message}`,
          onRetry: retrySession,
        }
      : { state: session.status === 'ready' && session.data.isSignedIn ? 'done' : 'pending' };

  const githubEntry: ChecklistEntry = githubStatusKnown
    ? { state: githubAuthenticated ? 'done' : 'pending' }
    : githubStatusLoading
      ? { state: 'pending' }
      : {
          state: 'unknown',
          unknownNote:
            githubRetryError ?? "Couldn't check your GitHub connection — status is unknown.",
          onRetry: retryGithubStatus,
        };

  const teamEntry: ChecklistEntry =
    teamStatus === 'unknown'
      ? {
          state: 'unknown',
          unknownNote: "Couldn't reach the team service — retry from the Team pulse panel.",
        }
      : { state: teamStatus === 'has-team' ? 'done' : 'pending' };

  const workItemsEntry: ChecklistEntry = workItemsError
    ? {
        state: 'unknown',
        unknownNote: `Couldn't load your work items: ${workItemsError}`,
        onRetry: retryWorkItems,
      }
    : { state: workItemsLoaded && items.length > 0 ? 'done' : 'pending' };

  const setup: SetupState = {
    signedIn: signedInEntry,
    githubConnected: githubEntry,
    hasTeam: teamEntry,
    hasWorkItems: workItemsEntry,
  };

  // Navigating without params keeps whatever the work-list last had stored, so
  // the composer's own item has to be named explicitly — otherwise creating
  // from the dashboard reopens the previously selected item instead.
  const handleCreated = useCallback(
    (item: { id: string; name: string }) => {
      invalidateWorkItems();
      navigate('work-list', { workItemId: item.id });
    },
    [navigate, invalidateWorkItems]
  );

  const handlePickup = useCallback(
    (itemId: string) => {
      navigate('work-list', { workItemId: itemId });
    },
    [navigate]
  );

  // Same two steps as the sidebar's session row: open the item, then its tab.
  const handleResume = useCallback(
    (itemId: string, sessionId: string) => {
      navigate('work-list', { workItemId: itemId });
      openCenterTab(itemId, { kind: 'session', sessionId });
    },
    [navigate]
  );

  const handleAction = useCallback(
    (key: string) => {
      switch (key) {
        case 'connect-github':
          void handleGithubConnect();
          break;
        case 'invite':
          navigate('settings', { tab: 'team' });
          break;
        case 'open-settings-integrations':
          // Lands on the key field itself, not just the tab that contains it.
          navigate('settings', { tab: 'integrations', card: 'team-pulse' });
          break;
        case 'create':
          inputAreaRef.current?.focus();
          break;
        case 'explore-skills':
          navigate('settings', { tab: 'skills' });
          break;
      }
    },
    [handleGithubConnect, navigate]
  );

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      <div className="flex-1 overflow-y-auto px-10 py-10 lg:px-12">
        <div className="@container max-w-[960px]">
          <GreetingHeader stats={stats} userName={userName} />
          <div className="animate-fade-up mb-8" style={{ animationDelay: '180ms' }}>
            <CreateWorkItemInput onCreated={handleCreated} inputRef={inputAreaRef} />
          </div>

          {session.status === 'error' && (
            <div className="animate-fade-up mb-8" style={{ animationDelay: '200ms' }}>
              <InlineNotice
                title="Couldn't load your account"
                message={`${session.message} Team features stay unavailable until this succeeds.`}
                onRetry={retrySession}
              />
            </div>
          )}

          {!isSetupComplete(setup) && (
            <div className="animate-fade-up" style={{ animationDelay: '240ms' }}>
              <SetupChecklist setup={setup} onAction={handleAction} />
            </div>
          )}

          <div className="animate-fade-up" style={{ animationDelay: '300ms' }}>
            {!workItemsFetched && !workItemsError && (
              <DashboardSection label="Your work">
                <CardSkeletons count={3} />
              </DashboardSection>
            )}
            <DashboardWork
              sections={sections}
              reviewRequests={reviewRequests}
              reviewRequestsFailed={reviewRequestsFailed}
              onRetryReviewRequests={retryReviewRequests}
              summaryMap={summaryMap}
              links={links}
              linksError={linksError}
              onRetryLinks={retryLinks}
              rosters={rosters}
              createdWithProvider={createdWithProvider}
              repoIdentities={repoIdentities}
              onOpen={handlePickup}
              onResume={handleResume}
            />
            {workItemsError && (
              <DashboardSection label="Your work">
                <InlineNotice
                  title="Couldn't load your work items"
                  message={workItemsError}
                  onRetry={retryWorkItems}
                />
              </DashboardSection>
            )}
            {workItemsLoaded && items.length === 0 && (
              <DashboardSection label="Your work">
                <NoWorkItemsState />
              </DashboardSection>
            )}
          </div>

          {recentlyCompleted.length > 0 && (
            <div className="animate-fade-up" style={{ animationDelay: '360ms' }}>
              <DashboardSection label="Recently completed">
                <div className="flex flex-col">
                  {recentlyCompleted.map((item) => (
                    <CompletedItem
                      key={item.id}
                      item={item}
                      onClick={() => handlePickup(item.id)}
                    />
                  ))}
                </div>
              </DashboardSection>
            </div>
          )}
        </div>
      </div>
      <div className="w-[280px] flex-shrink-0">
        <TeamPulseSidebar
          orgId={orgId}
          githubConnected={githubAuthenticated}
          onTeamStatus={setTeamStatus}
          onAction={handleAction}
        />
      </div>
    </div>
  );
}

export const dashboardView = {
  TitlebarSlot: DashboardTitlebar,
  MainPanel: DashboardMainPanel,
};
