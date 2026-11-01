import { randomUUID } from 'node:crypto';
import type { Octokit } from '@octokit/rest';
import { eq } from 'drizzle-orm';
import { parseGitHubRepository } from '@shared/github-repository';
import type { PullRequest } from '@shared/pull-requests';
import { GET_PR_CHECK_RUNS_BY_URL_QUERY } from '@main/core/github/services/pr-queries';
import { db } from '@main/db/client';
import {
  pullRequestAssignees,
  pullRequestChecks,
  pullRequestLabels,
  pullRequests,
  pullRequestUsers,
} from '@main/db/schema';
import { githubRateLimiter } from '@main/lib/rate-limiter';
import { withRetry } from '@main/lib/retry';
import type { CheckNode } from './pr-gql-types';
import { assemblePullRequest } from './pr-utils';

export async function runSyncChecks(
  pullRequestUrl: string,
  headRefOid: string,
  signal: AbortSignal,
  getOctokit: () => Promise<Octokit>
): Promise<boolean> {
  if (signal.aborted) return false;

  const existing = await db
    .select({ commitSha: pullRequestChecks.commitSha })
    .from(pullRequestChecks)
    .where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl))
    .limit(1);

  if (existing.length > 0 && existing[0].commitSha !== headRefOid) {
    await db.delete(pullRequestChecks).where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl));
  }

  const pr = await db
    .select({ identifier: pullRequests.identifier, repositoryUrl: pullRequests.repositoryUrl })
    .from(pullRequests)
    .where(eq(pullRequests.url, pullRequestUrl))
    .limit(1);

  if (!pr[0]) return false;

  const prNumber = pr[0].identifier ? parseInt(pr[0].identifier.replace('#', ''), 10) : NaN;
  if (isNaN(prNumber)) return false;

  const repository = parseGitHubRepository(pr[0].repositoryUrl);
  if (!repository) return false;
  const { owner, repo } = repository;
  const octokit = await getOctokit();

  const allNodes: CheckNode[] = [];
  let cursor: string | undefined;

  for (;;) {
    if (signal.aborted) return false;

    const response: {
      repository: {
        pullRequest: {
          commits: {
            nodes: Array<{
              commit: {
                oid: string;
                statusCheckRollup: {
                  contexts: {
                    pageInfo: { hasNextPage: boolean; endCursor: string | null };
                    nodes: CheckNode[];
                  };
                } | null;
              };
            }>;
          };
        } | null;
      };
    } = await withRetry(() =>
      githubRateLimiter.acquire().then(() =>
        octokit.graphql(GET_PR_CHECK_RUNS_BY_URL_QUERY, {
          owner,
          repo,
          number: prNumber,
          cursor: cursor ?? null,
        })
      )
    );

    const contexts =
      response.repository.pullRequest?.commits.nodes[0]?.commit?.statusCheckRollup?.contexts;
    if (!contexts) break;

    allNodes.push(...contexts.nodes);
    if (!contexts.pageInfo.hasNextPage) break;
    cursor = contexts.pageInfo.endCursor ?? undefined;
  }

  await db.delete(pullRequestChecks).where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl));

  if (allNodes.length > 0) {
    await db.insert(pullRequestChecks).values(
      allNodes.map((node) => {
        if (node.__typename === 'CheckRun') {
          return {
            id: randomUUID(),
            pullRequestUrl,
            commitSha: headRefOid,
            name: node.name,
            status: node.status,
            conclusion: node.conclusion ?? 'NEUTRAL',
            detailsUrl: node.detailsUrl ?? null,
            startedAt: node.startedAt ?? null,
            completedAt: node.completedAt ?? null,
            workflowName: node.checkSuite?.workflowRun?.workflow?.name ?? null,
            appName: node.checkSuite?.app?.name ?? null,
            appLogoUrl: node.checkSuite?.app?.logoUrl ?? null,
          };
        }
        return {
          id: randomUUID(),
          pullRequestUrl,
          commitSha: headRefOid,
          name: node.context,
          status: node.state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
          conclusion:
            node.state === 'SUCCESS'
              ? 'SUCCESS'
              : node.state === 'FAILURE' || node.state === 'ERROR'
                ? 'FAILURE'
                : 'NEUTRAL',
          detailsUrl: node.targetUrl ?? null,
          startedAt: node.createdAt,
          completedAt: node.state !== 'PENDING' ? node.createdAt : null,
          workflowName: null,
          appName: null,
          appLogoUrl: null,
        };
      })
    );
  }

  const hasRunning = allNodes.some((n) => {
    if (n.__typename === 'CheckRun') {
      return (
        n.status === 'IN_PROGRESS' ||
        n.status === 'QUEUED' ||
        n.status === 'WAITING' ||
        n.status === 'PENDING'
      );
    }
    return n.state === 'PENDING';
  });

  return hasRunning;
}

export async function notifyPrWithChecks(pullRequestUrl: string): Promise<PullRequest | null> {
  const [prRow] = await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.url, pullRequestUrl))
    .limit(1);

  if (!prRow) return null;

  const [checkRows, labelRows, assigneeJoins] = await Promise.all([
    db.select().from(pullRequestChecks).where(eq(pullRequestChecks.pullRequestUrl, pullRequestUrl)),
    db.select().from(pullRequestLabels).where(eq(pullRequestLabels.pullRequestId, pullRequestUrl)),
    db
      .select({ user: pullRequestUsers })
      .from(pullRequestAssignees)
      .innerJoin(pullRequestUsers, eq(pullRequestAssignees.userId, pullRequestUsers.userId))
      .where(eq(pullRequestAssignees.pullRequestUrl, pullRequestUrl)),
  ]);

  let authorRow: typeof pullRequestUsers.$inferSelect | null = null;
  if (prRow.authorUserId) {
    const [a] = await db
      .select()
      .from(pullRequestUsers)
      .where(eq(pullRequestUsers.userId, prRow.authorUserId))
      .limit(1);
    authorRow = a ?? null;
  }

  return assemblePullRequest(
    prRow,
    authorRow,
    labelRows,
    assigneeJoins.map((j) => j.user),
    checkRows
  );
}
