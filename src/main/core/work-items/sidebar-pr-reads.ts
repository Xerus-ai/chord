import { inArray } from 'drizzle-orm';
import { db } from '@main/db/client';
import { pullRequestChecks, pullRequests } from '@main/db/schema';
import type { CheckFacts } from './checks-passing';

export interface PrFacts {
  url: string;
  status: string;
  isDraft: number | null;
  mergeableStatus: string | null;
  reviewDecision: string | null;
  headRefOid: string;
}

export interface PrData {
  byUrl: Map<string, PrFacts>;
  checksByUrl: Map<string, CheckFacts[]>;
}

/** One round trip for every PR a batch of work items references, plus the
 * checks on each PR's current head commit. */
export async function readPullRequestData(prUrls: string[]): Promise<PrData> {
  if (prUrls.length === 0) return { byUrl: new Map(), checksByUrl: new Map() };

  const prRows = await db
    .select({
      url: pullRequests.url,
      status: pullRequests.status,
      isDraft: pullRequests.isDraft,
      mergeableStatus: pullRequests.mergeableStatus,
      reviewDecision: pullRequests.reviewDecision,
      headRefOid: pullRequests.headRefOid,
    })
    .from(pullRequests)
    .where(inArray(pullRequests.url, prUrls));

  const checkRows = await db
    .select({
      pullRequestUrl: pullRequestChecks.pullRequestUrl,
      commitSha: pullRequestChecks.commitSha,
      status: pullRequestChecks.status,
      conclusion: pullRequestChecks.conclusion,
    })
    .from(pullRequestChecks)
    .where(inArray(pullRequestChecks.pullRequestUrl, prUrls));

  const checksByUrl = new Map<string, CheckFacts[]>();
  for (const check of checkRows) {
    checksByUrl.set(check.pullRequestUrl, [
      ...(checksByUrl.get(check.pullRequestUrl) ?? []),
      check,
    ]);
  }

  return { byUrl: new Map(prRows.map((pr) => [pr.url, pr])), checksByUrl };
}
