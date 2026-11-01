import type { DashboardLinksById } from '@shared/dashboard-links';
import type { NeedsYouPullRequestRef, SidebarSummary } from '@shared/sidebar-summaries';
import {
  resolveRepoIdentity,
  type RepoIdentityLookup,
} from '@renderer/features/app-sidebar/repo-identity-lookup';
import type { SidebarItem } from '@renderer/features/app-sidebar/sidebar-projection';
import type { AvatarStackMember } from '@renderer/lib/components/chrome/avatar-stack';
import { DashboardCard } from './dashboard-card';
import {
  resolveCardBranch,
  resolveCardProviderId,
  type DashboardSections,
} from './dashboard-projection';
import {
  DashboardSection,
  InlineNotice,
  ReviewRequestRow,
  ReviewRequestsError,
} from './dashboard-sections';

const NO_MEMBERS: AvatarStackMember[] = [];

/** The live session a card's Resume returns to: the one active most recently. */
function newestLiveSessionId(summary: SidebarSummary | undefined): string | null {
  let newest: { sessionId: string; lastActiveAt: number } | null = null;
  for (const worktree of summary?.worktrees ?? []) {
    for (const session of worktree.liveSessions) {
      if (!newest || session.lastActiveAt > newest.lastActiveAt) newest = session;
    }
  }
  return newest?.sessionId ?? null;
}

export interface DashboardWorkProps {
  sections: DashboardSections;
  reviewRequests: NeedsYouPullRequestRef[];
  reviewRequestsFailed: boolean;
  onRetryReviewRequests: () => void;
  summaryMap: ReadonlyMap<string, SidebarSummary>;
  links: DashboardLinksById | undefined;
  linksError: string | null;
  onRetryLinks: () => void;
  rosters: ReadonlyMap<string, AvatarStackMember[]>;
  /** `work_items.agent_provider` by id — the agent each item was created with. */
  createdWithProvider: ReadonlyMap<string, string | null>;
  repoIdentities: RepoIdentityLookup;
  onOpen: (workItemId: string) => void;
  onResume: (workItemId: string, sessionId: string) => void;
}

/** Needs you › Running now › Pick back up — each item once, empty sections absent. */
export function DashboardWork({
  sections,
  reviewRequests,
  reviewRequestsFailed,
  onRetryReviewRequests,
  summaryMap,
  links,
  linksError,
  onRetryLinks,
  rosters,
  createdWithProvider,
  repoIdentities,
  onOpen,
  onResume,
}: DashboardWorkProps) {
  const renderCard = (item: SidebarItem) => {
    const summary = summaryMap.get(item.id);
    return (
      <DashboardCard
        key={item.id}
        item={item}
        description={summary?.description ?? null}
        links={links?.[item.id]}
        providerId={resolveCardProviderId(item, createdWithProvider.get(item.id) ?? null)}
        branch={resolveCardBranch(item, summary?.checkoutBranch ?? null)}
        repoIcon={resolveRepoIdentity(repoIdentities, item.repoId).icon}
        sharedWith={rosters.get(item.id) ?? NO_MEMBERS}
        lastActiveAt={summary?.lastFinishedTurnAt ?? item.updatedAt}
        resumeSessionId={newestLiveSessionId(summary)}
        onOpen={() => onOpen(item.id)}
        onResume={(sessionId) => onResume(item.id, sessionId)}
      />
    );
  };

  const needsYouCount = sections.needsYou.length + reviewRequests.length;
  const showNeedsYou = needsYouCount > 0 || reviewRequestsFailed;

  return (
    <>
      {linksError && (
        <div className="mb-5">
          <InlineNotice
            title="Couldn't load tickets and artifacts"
            message={`${linksError} Cards show everything else.`}
            onRetry={onRetryLinks}
          />
        </div>
      )}
      {showNeedsYou && (
        <DashboardSection label="Needs you" count={needsYouCount}>
          {sections.needsYou.map(renderCard)}
          {reviewRequests.map((pullRequest) => (
            <ReviewRequestRow key={pullRequest.key} pullRequest={pullRequest} />
          ))}
          {reviewRequestsFailed && <ReviewRequestsError onRetry={onRetryReviewRequests} />}
        </DashboardSection>
      )}
      {sections.running.length > 0 && (
        <DashboardSection label="Running now" count={sections.running.length}>
          {sections.running.map(renderCard)}
        </DashboardSection>
      )}
      {sections.pickUp.length > 0 && (
        <DashboardSection label="Pick back up" count={sections.pickUp.length} layout="grid">
          {sections.pickUp.map(renderCard)}
        </DashboardSection>
      )}
    </>
  );
}
