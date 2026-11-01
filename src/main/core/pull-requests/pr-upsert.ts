import { eq } from 'drizzle-orm';
import { parseGitHubRepository } from '@shared/github-repository';
import type { PullRequest, PullRequestStatus } from '@shared/pull-requests';
import { db } from '@main/db/client';
import {
  pullRequestAssignees,
  pullRequestChecks,
  pullRequestLabels,
  pullRequests,
  pullRequestUsers,
} from '@main/db/schema';
import { actorUserId, type GqlPrNode } from './pr-gql-types';
import { assemblePullRequest } from './pr-utils';

export async function upsertBatch(
  repositoryUrl: string,
  nodes: GqlPrNode[]
): Promise<PullRequest[]> {
  const results: PullRequest[] = [];
  for (const node of nodes) {
    const pr = await upsertOne(repositoryUrl, node);
    if (pr) results.push(pr);
  }
  return results;
}

async function upsertOne(repositoryUrl: string, node: GqlPrNode): Promise<PullRequest | null> {
  const status: PullRequestStatus =
    node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : 'open';

  const headRepositoryUrl =
    parseGitHubRepository(node.headRepository?.url)?.repositoryUrl ?? repositoryUrl;

  const baseRepositoryUrl =
    parseGitHubRepository(node.baseRepository?.url)?.repositoryUrl ?? repositoryUrl;

  let authorUserId: string | null = null;
  if (node.author) {
    authorUserId = actorUserId(node.author);
    await db
      .insert(pullRequestUsers)
      .values({
        userId: authorUserId,
        userName: node.author.login,
        displayName: node.author.login,
        avatarUrl: node.author.avatarUrl || null,
        url: node.author.url ?? null,
        userCreatedAt: node.author.createdAt ?? null,
        userUpdatedAt: node.author.updatedAt ?? null,
      })
      .onConflictDoUpdate({
        target: pullRequestUsers.userId,
        set: {
          userName: node.author.login,
          displayName: node.author.login,
          avatarUrl: node.author.avatarUrl || null,
        },
      });
  }

  const [prRow] = await db
    .insert(pullRequests)
    .values({
      url: node.url,
      provider: 'github',
      repositoryUrl: baseRepositoryUrl,
      baseRefName: node.baseRefName,
      baseRefOid: node.baseRefOid,
      headRepositoryUrl,
      headRefName: node.headRefName,
      headRefOid: node.headRefOid,
      identifier: `#${node.number}`,
      title: node.title,
      description: node.body ?? null,
      status,
      isDraft: node.isDraft ? 1 : 0,
      authorUserId,
      additions: node.additions,
      deletions: node.deletions,
      changedFiles: node.changedFiles,
      commitCount: node.commitCount?.totalCount ?? null,
      mergeableStatus: node.mergeable,
      mergeStateStatus: node.mergeStateStatus ?? null,
      reviewDecision: node.reviewDecision ?? null,
      pullRequestCreatedAt: node.createdAt,
      pullRequestUpdatedAt: node.updatedAt,
    })
    .onConflictDoUpdate({
      target: pullRequests.url,
      set: {
        baseRefName: node.baseRefName,
        baseRefOid: node.baseRefOid,
        headRepositoryUrl,
        headRefName: node.headRefName,
        headRefOid: node.headRefOid,
        title: node.title,
        description: node.body ?? null,
        status,
        isDraft: node.isDraft ? 1 : 0,
        authorUserId,
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        commitCount: node.commitCount?.totalCount ?? null,
        mergeableStatus: node.mergeable,
        mergeStateStatus: node.mergeStateStatus ?? null,
        reviewDecision: node.reviewDecision ?? null,
        pullRequestUpdatedAt: node.updatedAt,
      },
    })
    .returning();

  if (!prRow) return null;

  await db.delete(pullRequestLabels).where(eq(pullRequestLabels.pullRequestId, node.url));
  if (node.labels.nodes.length > 0) {
    await db.insert(pullRequestLabels).values(
      node.labels.nodes.map((l) => ({
        pullRequestId: node.url,
        name: l.name,
        color: l.color ?? null,
      }))
    );
  }

  await db.delete(pullRequestAssignees).where(eq(pullRequestAssignees.pullRequestUrl, node.url));
  const assigneeRows: (typeof pullRequestUsers.$inferSelect)[] = [];
  for (const a of node.assignees.nodes) {
    const uid = actorUserId(a);
    await db
      .insert(pullRequestUsers)
      .values({
        userId: uid,
        userName: a.login,
        displayName: a.login,
        avatarUrl: a.avatarUrl || null,
        url: a.url ?? null,
        userCreatedAt: a.createdAt ?? null,
        userUpdatedAt: a.updatedAt ?? null,
      })
      .onConflictDoUpdate({
        target: pullRequestUsers.userId,
        set: { userName: a.login, displayName: a.login, avatarUrl: a.avatarUrl || null },
      });

    await db
      .insert(pullRequestAssignees)
      .values({ pullRequestUrl: node.url, userId: uid })
      .onConflictDoNothing();

    assigneeRows.push({
      userId: uid,
      userName: a.login,
      displayName: a.login,
      avatarUrl: a.avatarUrl || null,
      url: a.url ?? null,
      userCreatedAt: a.createdAt ?? null,
      userUpdatedAt: a.updatedAt ?? null,
    });
  }

  const authorRow = node.author
    ? {
        userId: actorUserId(node.author),
        userName: node.author.login,
        displayName: node.author.login,
        avatarUrl: node.author.avatarUrl || null,
        url: node.author.url ?? null,
        userCreatedAt: node.author.createdAt ?? null,
        userUpdatedAt: node.author.updatedAt ?? null,
      }
    : null;

  const labelRows = node.labels.nodes.map((l) => ({
    pullRequestId: node.url,
    name: l.name,
    color: l.color ?? null,
  }));

  const checkRows = await db
    .select()
    .from(pullRequestChecks)
    .where(eq(pullRequestChecks.pullRequestUrl, node.url));

  return assemblePullRequest(prRow, authorRow, labelRows, assigneeRows, checkRows);
}
