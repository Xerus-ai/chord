import { eq } from 'drizzle-orm';
import type {
  PullRequestCheck,
  PullRequestReview,
  PullRequestReviewComment,
} from '@shared/pull-requests';
import { db } from '@main/db/client';
import {
  pullRequestChecks,
  pullRequestReviewComments,
  pullRequestReviews,
  pullRequests,
} from '@main/db/schema';
import { readLanePr } from './lane-pull-requests';
import { prSyncEngine } from './pr-sync-engine';

export interface WorkItemChecks {
  checks: PullRequestCheck[];
  mergeableStatus: string | null;
  mergeStateStatus: string | null;
}

/**
 * The lane's PR url — the primary's when no lane is named. Null when the lane
 * has no pull request: not an error, just no PR yet.
 */
async function readLanePrUrl(workItemId: string, worktreeId?: string): Promise<string | null> {
  return (await readLanePr(workItemId, worktreeId))?.url ?? null;
}

export async function readWorkItemChecks(
  workItemId: string,
  worktreeId?: string
): Promise<WorkItemChecks> {
  const prUrl = await readLanePrUrl(workItemId, worktreeId);
  if (!prUrl) return { checks: [], mergeableStatus: null, mergeStateStatus: null };

  const checkRows = await db
    .select()
    .from(pullRequestChecks)
    .where(eq(pullRequestChecks.pullRequestUrl, prUrl));

  const [prRow] = await db
    .select({
      mergeableStatus: pullRequests.mergeableStatus,
      mergeStateStatus: pullRequests.mergeStateStatus,
    })
    .from(pullRequests)
    .where(eq(pullRequests.url, prUrl))
    .limit(1);

  const checks: PullRequestCheck[] = checkRows.map((row) => ({
    id: row.id,
    pullRequestUrl: row.pullRequestUrl,
    commitSha: row.commitSha,
    name: row.name,
    status: row.status,
    conclusion: row.conclusion ?? null,
    detailsUrl: row.detailsUrl ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    workflowName: row.workflowName ?? null,
    appName: row.appName ?? null,
    appLogoUrl: row.appLogoUrl ?? null,
  }));

  return {
    checks,
    mergeableStatus: prRow?.mergeableStatus ?? null,
    mergeStateStatus: prRow?.mergeStateStatus ?? null,
  };
}

export async function readWorkItemReviews(
  workItemId: string,
  worktreeId?: string
): Promise<PullRequestReview[]> {
  const prUrl = await readLanePrUrl(workItemId, worktreeId);
  if (!prUrl) return [];

  const reviewRows = await db
    .select()
    .from(pullRequestReviews)
    .where(eq(pullRequestReviews.pullRequestUrl, prUrl));

  const commentRows = await db
    .select()
    .from(pullRequestReviewComments)
    .where(eq(pullRequestReviewComments.pullRequestUrl, prUrl));

  const commentsByReview = new Map<string, PullRequestReviewComment[]>();
  for (const c of commentRows) {
    const arr = commentsByReview.get(c.reviewId) ?? [];
    arr.push({
      id: c.id,
      reviewId: c.reviewId,
      path: c.path ?? null,
      line: c.line ?? null,
      body: c.body,
      authorLogin: c.authorLogin,
      authorAvatarUrl: c.authorAvatarUrl ?? null,
      createdAt: c.createdAt,
    });
    commentsByReview.set(c.reviewId, arr);
  }

  return reviewRows.map((row) => ({
    id: row.id,
    pullRequestUrl: row.pullRequestUrl,
    reviewerId: row.reviewerId,
    reviewerLogin: row.reviewerLogin,
    reviewerAvatarUrl: row.reviewerAvatarUrl ?? null,
    state: row.state as PullRequestReview['state'],
    submittedAt: row.submittedAt ?? null,
    body: row.body ?? null,
    comments: commentsByReview.get(row.id) ?? [],
  }));
}

/**
 * `synced: false` means there was nothing to sync — no PR on the lane, or
 * no cached PR row to take a head commit from. A sync that was attempted and
 * failed throws.
 */
export async function syncWorkItemChecks(
  workItemId: string,
  worktreeId?: string
): Promise<{ synced: boolean; hasRunning?: boolean }> {
  const prUrl = await readLanePrUrl(workItemId, worktreeId);
  if (!prUrl) return { synced: false };

  const [prRow] = await db
    .select({ headRefOid: pullRequests.headRefOid })
    .from(pullRequests)
    .where(eq(pullRequests.url, prUrl))
    .limit(1);
  if (!prRow) return { synced: false };

  const hasRunning = await prSyncEngine.syncChecks(prUrl, prRow.headRefOid);
  return { synced: true, hasRunning };
}

export async function syncWorkItemReviews(
  workItemId: string,
  worktreeId?: string
): Promise<{ synced: boolean }> {
  const prUrl = await readLanePrUrl(workItemId, worktreeId);
  if (!prUrl) return { synced: false };

  await prSyncEngine.syncReviews(prUrl);
  return { synced: true };
}
