import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@main/db/client';
import { pullRequests } from '@main/db/schema';

const matchColumns = {
  url: pullRequests.url,
  identifier: pullRequests.identifier,
  title: pullRequests.title,
  status: pullRequests.status,
  isDraft: pullRequests.isDraft,
  headRefName: pullRequests.headRefName,
  baseRefName: pullRequests.baseRefName,
  headRefOid: pullRequests.headRefOid,
  mergeableStatus: pullRequests.mergeableStatus,
  reviewDecision: pullRequests.reviewDecision,
  additions: pullRequests.additions,
  deletions: pullRequests.deletions,
};

export type BranchPullRequestRow = {
  url: string;
  identifier: string | null;
  title: string;
  status: string;
  isDraft: number | null;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  mergeableStatus: string | null;
  reviewDecision: string | null;
  additions: number | null;
  deletions: number | null;
};

/**
 * The synced PR for each branch, matched the way GitHub pairs them: a PR whose
 * head is that branch in `headRepositoryUrl` (the checkout's own repository, a
 * fork's included). A reused branch gets its most recently updated PR. One
 * query for every branch.
 */
export async function findPullRequestsForBranches(
  headRepositoryUrl: string,
  branches: readonly string[]
): Promise<Map<string, BranchPullRequestRow>> {
  if (branches.length === 0) return new Map();
  const rows = await db
    .select(matchColumns)
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.headRepositoryUrl, headRepositoryUrl),
        inArray(pullRequests.headRefName, [...branches])
      )
    )
    .orderBy(desc(pullRequests.pullRequestUpdatedAt));
  const byBranch = new Map<string, BranchPullRequestRow>();
  for (const row of rows) {
    if (!byBranch.has(row.headRefName)) byBranch.set(row.headRefName, row);
  }
  return byBranch;
}

/** The PR's number: `identifier` is `#12` as the sync writes it; the URL ends in `/pull/12`. */
export function readPullRequestNumber(row: { identifier: string | null; url: string }): number {
  const match = /^#(\d+)$/.exec(row.identifier ?? '') ?? /\/pull\/(\d+)\/?$/.exec(row.url);
  if (!match) throw new Error(`Pull request ${row.url} has no number`);
  return Number(match[1]);
}
