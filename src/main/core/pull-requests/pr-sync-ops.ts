import type { Octokit } from '@octokit/rest';
import { parseGitHubRepositoryResult } from '@shared/github-repository';
import type { PrSyncProgress } from '@shared/pull-requests';
import { INCREMENTAL_SYNC_PRS_QUERY, SYNC_PRS_QUERY } from '@main/core/github/services/pr-queries';
import type { KV } from '@main/db/kv';
import { log } from '@main/lib/logger';
import { githubRateLimiter } from '@main/lib/rate-limiter';
import { withRetry } from '@main/lib/retry';
import {
  PR_SYNC_MAX_COUNT,
  type FullSyncCursor,
  type GqlPrNode,
  type IncrementalSyncCursor,
  type PrKvSchema,
} from './pr-gql-types';
import { upsertBatch } from './pr-upsert';

export async function runFullSync(
  repositoryUrl: string,
  signal: AbortSignal,
  kv: KV<PrKvSchema>,
  getOctokit: () => Promise<Octokit>,
  emitProgress: (progress: PrSyncProgress) => void,
  archiveOldPrs: (repositoryUrl: string) => Promise<void>
): Promise<void> {
  log.info('PrSyncEngine: runFullSync start', { repositoryUrl });
  const repository = parseGitHubRepositoryResult(repositoryUrl);
  if (!repository.success) {
    emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'full',
      status: 'error',
      error: `Invalid GitHub repository URL: "${repository.error.input}"`,
    });
    return;
  }
  const { owner, repo } = repository.data;
  const octokit = await getOctokit().catch((e: unknown) => {
    log.warn('PrSyncEngine: runFullSync — failed to get Octokit (not authenticated?)', {
      repositoryUrl,
      error: String(e),
    });
    throw e;
  });

  const existing = (await kv.get(`fullsync:${repositoryUrl}`)) as FullSyncCursor | null;
  let pageCursor: string | undefined = existing?.done ? undefined : existing?.pageCursor;
  let synced = 0;

  emitProgress({ remoteUrl: repositoryUrl, kind: 'full', status: 'running', synced: 0 });

  try {
    for (;;) {
      if (signal.aborted) return;

      const response = await withRetry(
        () =>
          githubRateLimiter.acquire().then(() =>
            octokit.graphql<{
              repository: {
                pullRequests: {
                  totalCount: number;
                  pageInfo: { hasNextPage: boolean; endCursor: string | null };
                  nodes: GqlPrNode[];
                };
              };
            }>(SYNC_PRS_QUERY, { owner, repo, cursor: pageCursor ?? null, request: { signal } })
          ),
        { signal }
      );

      const { nodes, pageInfo, totalCount } = response.repository.pullRequests;
      const batch: GqlPrNode[] = nodes.slice();

      if (batch.length > 0) {
        await upsertBatch(repositoryUrl, batch);
        synced += batch.length;
      }

      const lastUpdatedAt =
        batch[batch.length - 1]?.updatedAt ?? existing?.lastUpdatedAt ?? new Date().toISOString();
      const done = !pageInfo.hasNextPage || synced >= PR_SYNC_MAX_COUNT;

      await kv.set(`fullsync:${repositoryUrl}`, {
        lastUpdatedAt,
        done,
        pageCursor: done ? undefined : (pageInfo.endCursor ?? undefined),
      } as FullSyncCursor);

      emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'full',
        status: 'running',
        synced,
        total: Math.min(totalCount, PR_SYNC_MAX_COUNT),
      });

      if (done) break;
      pageCursor = pageInfo.endCursor ?? undefined;
    }

    await archiveOldPrs(repositoryUrl);
    emitProgress({ remoteUrl: repositoryUrl, kind: 'full', status: 'done', synced });
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') {
      emitProgress({ remoteUrl: repositoryUrl, kind: 'full', status: 'cancelled' });
      return;
    }
    emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'full',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function runIncrementalSync(
  repositoryUrl: string,
  signal: AbortSignal,
  kv: KV<PrKvSchema>,
  getOctokit: () => Promise<Octokit>,
  emitProgress: (progress: PrSyncProgress) => void
): Promise<void> {
  log.info('PrSyncEngine: runIncrementalSync started', { repositoryUrl });

  const repository = parseGitHubRepositoryResult(repositoryUrl);
  if (!repository.success) {
    emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'incremental',
      status: 'error',
      error: `Invalid GitHub repository URL: "${repository.error.input}"`,
    });
    return;
  }
  const { owner, repo } = repository.data;
  const octokit = await getOctokit().catch((e: unknown) => {
    log.warn('PrSyncEngine: runIncrementalSync — failed to get Octokit (not authenticated?)', {
      repositoryUrl,
      error: String(e),
    });
    throw e;
  });

  const fullCursor = (await kv.get(`fullsync:${repositoryUrl}`)) as FullSyncCursor | null;
  const incrementalCursor = (await kv.get(
    `incrementalsync:${repositoryUrl}`
  )) as IncrementalSyncCursor | null;
  const sinceUpdatedAt =
    incrementalCursor?.lastUpdatedAt ?? fullCursor?.lastUpdatedAt ?? new Date(0).toISOString();

  let pageCursor: string | undefined = incrementalCursor?.done
    ? undefined
    : incrementalCursor?.pageCursor;
  let synced = 0;
  let lastUpdatedAt = sinceUpdatedAt;

  emitProgress({
    remoteUrl: repositoryUrl,
    kind: 'incremental',
    status: 'running',
    synced: 0,
  });

  try {
    for (;;) {
      if (signal.aborted) return;

      const response = await withRetry(
        () =>
          githubRateLimiter.acquire().then(() =>
            octokit.graphql<{
              repository: {
                pullRequests: {
                  pageInfo: { hasNextPage: boolean; endCursor: string | null };
                  nodes: GqlPrNode[];
                };
              };
            }>(INCREMENTAL_SYNC_PRS_QUERY, {
              owner,
              repo,
              cursor: pageCursor ?? null,
              request: { signal },
            })
          ),
        { signal }
      );

      const { nodes, pageInfo } = response.repository.pullRequests;
      let reachedBoundary = false;
      const batch: GqlPrNode[] = [];

      for (const node of nodes) {
        if (node.updatedAt < sinceUpdatedAt) {
          reachedBoundary = true;
          break;
        }
        batch.push(node);
      }

      if (batch.length > 0) {
        await upsertBatch(repositoryUrl, batch);
        synced += batch.length;
        lastUpdatedAt = batch[0].updatedAt;
      }

      if (synced >= PR_SYNC_MAX_COUNT) {
        log.info('PrSyncEngine: incremental overflow — resetting to full sync', {
          repositoryUrl,
          synced,
        });
        await kv.del(`fullsync:${repositoryUrl}`);
        await kv.del(`incrementalsync:${repositoryUrl}`);
        emitProgress({
          remoteUrl: repositoryUrl,
          kind: 'incremental',
          status: 'done',
          synced,
        });
        return;
      }

      const done = reachedBoundary || !pageInfo.hasNextPage;

      await kv.set(`incrementalsync:${repositoryUrl}`, {
        lastUpdatedAt,
        pageCursor: done ? undefined : (pageInfo.endCursor ?? undefined),
        done,
      } as IncrementalSyncCursor);

      emitProgress({
        remoteUrl: repositoryUrl,
        kind: 'incremental',
        status: 'running',
        synced,
      });

      if (done) break;
      pageCursor = pageInfo.endCursor ?? undefined;
    }

    emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'incremental',
      status: 'done',
      synced,
    });
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') {
      emitProgress({ remoteUrl: repositoryUrl, kind: 'incremental', status: 'cancelled' });
      return;
    }
    emitProgress({
      remoteUrl: repositoryUrl,
      kind: 'incremental',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
