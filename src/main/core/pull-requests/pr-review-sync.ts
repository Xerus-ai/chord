import type { Octokit } from '@octokit/rest';
import { eq } from 'drizzle-orm';
import { parseGitHubRepository } from '@shared/github-repository';
import { GET_PR_REVIEWS_QUERY } from '@main/core/github/services/pr-queries';
import { db } from '@main/db/client';
import { pullRequestReviewComments, pullRequestReviews, pullRequests } from '@main/db/schema';
import { githubRateLimiter } from '@main/lib/rate-limiter';
import { withRetry } from '@main/lib/retry';

interface GqlReviewCommentNode {
  id: string;
  path: string | null;
  line: number | null;
  body: string;
  createdAt: string;
  author: { login: string; avatarUrl: string } | null;
}

interface GqlReviewNode {
  id: string;
  state: string;
  body: string | null;
  submittedAt: string | null;
  author: { login: string; avatarUrl: string; databaseId?: number } | null;
  comments: { nodes: GqlReviewCommentNode[] };
}

export async function runSyncReviews(
  pullRequestUrl: string,
  getOctokit: () => Promise<Octokit>
): Promise<void> {
  const [prRow] = await db
    .select({
      identifier: pullRequests.identifier,
      repositoryUrl: pullRequests.repositoryUrl,
    })
    .from(pullRequests)
    .where(eq(pullRequests.url, pullRequestUrl))
    .limit(1);

  if (!prRow) return;

  const prNumber = prRow.identifier ? parseInt(prRow.identifier.replace('#', ''), 10) : NaN;
  if (isNaN(prNumber)) return;

  const repository = parseGitHubRepository(prRow.repositoryUrl);
  if (!repository) return;
  const { owner, repo } = repository;
  const octokit = await getOctokit();

  const allReviews: GqlReviewNode[] = [];
  let cursor: string | undefined;

  for (;;) {
    const response: {
      repository: {
        pullRequest: {
          reviews: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: GqlReviewNode[];
          };
        } | null;
      };
    } = await withRetry(() =>
      githubRateLimiter.acquire().then(() =>
        octokit.graphql(GET_PR_REVIEWS_QUERY, {
          owner,
          repo,
          number: prNumber,
          cursor: cursor ?? null,
        })
      )
    );

    const reviews = response.repository.pullRequest?.reviews;
    if (!reviews) break;

    allReviews.push(...reviews.nodes);
    if (!reviews.pageInfo.hasNextPage) break;
    cursor = reviews.pageInfo.endCursor ?? undefined;
  }

  await db
    .delete(pullRequestReviewComments)
    .where(eq(pullRequestReviewComments.pullRequestUrl, pullRequestUrl));
  await db.delete(pullRequestReviews).where(eq(pullRequestReviews.pullRequestUrl, pullRequestUrl));

  for (const review of allReviews) {
    const reviewerId = review.author
      ? review.author.databaseId != null
        ? String(review.author.databaseId)
        : `login:${review.author.login}`
      : `unknown:${review.id}`;

    await db.insert(pullRequestReviews).values({
      id: review.id,
      pullRequestUrl,
      reviewerId,
      reviewerLogin: review.author?.login ?? 'unknown',
      reviewerAvatarUrl: review.author?.avatarUrl ?? null,
      state: review.state,
      submittedAt: review.submittedAt ?? null,
      body: review.body ?? null,
    });

    if (review.comments.nodes.length > 0) {
      await db.insert(pullRequestReviewComments).values(
        review.comments.nodes.map((c) => ({
          id: c.id,
          pullRequestUrl,
          reviewId: review.id,
          path: c.path ?? null,
          line: c.line ?? null,
          body: c.body,
          authorLogin: c.author?.login ?? 'unknown',
          authorAvatarUrl: c.author?.avatarUrl ?? null,
          createdAt: c.createdAt,
        }))
      );
    }
  }
}
