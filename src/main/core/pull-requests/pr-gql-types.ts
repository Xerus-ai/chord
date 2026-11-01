import type { MergeableState, MergeStateStatus } from '@shared/pull-requests';

export const PR_SYNC_MAX_COUNT = 300;
export const PR_ARCHIVE_AGE_MONTHS = 6;

export type FullSyncCursor = {
  lastUpdatedAt: string;
  done: boolean;
  pageCursor?: string;
};

export type IncrementalSyncCursor = {
  lastUpdatedAt: string;
  pageCursor?: string;
  done: boolean;
};

export type PrKvSchema = {
  [key: string]: FullSyncCursor | IncrementalSyncCursor | string;
};

export interface GqlUser {
  databaseId?: number;
  login: string;
  avatarUrl: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

export function actorUserId(actor: GqlUser): string {
  return actor.databaseId != null ? String(actor.databaseId) : `login:${actor.login}`;
}

export interface GqlPrNode {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  commitCount?: { totalCount: number };
  body: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: MergeableState;
  mergeStateStatus: MergeStateStatus | null;
  author: GqlUser | null;
  headRepository: { nameWithOwner: string; url: string; owner: { login: string } } | null;
  baseRepository: { url: string } | null;
  labels: { nodes: Array<{ name: string; color: string }> };
  assignees: { nodes: GqlUser[] };
  reviewDecision: string | null;
}

export interface GqlCheckRunNode {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkSuite: {
    app: { name: string; logoUrl: string } | null;
    workflowRun: { workflow: { name: string } } | null;
  } | null;
}

export interface GqlStatusContextNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt: string;
}

export type CheckNode = GqlCheckRunNode | GqlStatusContextNode;
