import type {
  SidebarPullRequestSummary,
  SidebarSummary,
  SidebarWorktreeSummary,
} from '@shared/sidebar-summaries';
import type { SidebarItem } from '../sidebar-projection';

/** Sidebar rows and summaries for row-presentation tests, overridable per case. */

export function makeItem(overrides: Partial<SidebarItem> = {}): SidebarItem {
  return {
    id: 'wi-1',
    name: 'Redesigning work item',
    repoId: 'repo-a',
    repoLabel: 'devstation',
    branchName: 'redesining-work-item',
    bucket: 'idle',
    updatedAt: 1_800_000_000,
    createdAt: 1_799_000_000,
    ownership: 'mine',
    owner: null,
    sharedArtifacts: null,
    diffStats: null,
    pullRequestUrl: null,
    pullRequest: null,
    providerId: null,
    devServerUrl: null,
    worktreeCount: 1,
    liveSessionCount: 0,
    needsYou: [],
    unread: false,
    provisionStatus: 'ready',
    ownedByAnotherAccount: false,
    repoHint: null,
    compareCue: null,
    ...overrides,
  };
}

export function makePullRequest(
  overrides: Partial<SidebarPullRequestSummary> = {}
): SidebarPullRequestSummary {
  return {
    url: 'https://github.com/acme/app/pull/214',
    number: 214,
    state: 'in_review',
    checks: null,
    ...overrides,
  };
}

export function makeWorktree(
  overrides: Partial<SidebarWorktreeSummary> = {}
): SidebarWorktreeSummary {
  return {
    id: 'wt-1',
    branch: 'redesining-work-item',
    targetRef: 'origin/main',
    title: null,
    isPrimary: true,
    diffStats: null,
    compareBase: { kind: 'ref', mode: 'repoDefault', ref: 'origin/main' },
    providerId: null,
    bucket: 'idle',
    liveSessions: [],
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<SidebarSummary> = {}): SidebarSummary {
  return {
    id: 'wi-1',
    diffStats: null,
    pullRequest: null,
    sessionCount: 0,
    aggregateBucket: 'idle',
    worktrees: [makeWorktree()],
    needsYou: [],
    description: null,
    devServerUrl: null,
    checkoutBranch: null,
    lastFinishedTurnAt: null,
    archivedLaneCount: 0,
    ...overrides,
  };
}
