import type { Octokit } from '@octokit/rest';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import { prSyncProgressChannel, prUpdatedChannel } from '@shared/events/prEvents';
import {
  parseGitHubRepositoryResult,
  type GitHubRepositoryParseError,
} from '@shared/github-repository';
import type { PrSyncProgress, PullRequest, PullRequestFile } from '@shared/pull-requests';
import { ok, type Result } from '@shared/result';
import { getOctokit } from '@main/core/github/services/octokit-provider';
import { GET_PR_BY_NUMBER_QUERY } from '@main/core/github/services/pr-queries';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { projectRemotes, pullRequests } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { githubRateLimiter } from '@main/lib/rate-limiter';
import { withRetry } from '@main/lib/retry';
import { notifyPrWithChecks, runSyncChecks } from './pr-checks-sync';
import {
  PR_ARCHIVE_AGE_MONTHS,
  type FullSyncCursor,
  type GqlPrNode,
  type PrKvSchema,
} from './pr-gql-types';
import { runSyncReviews } from './pr-review-sync';
import { runFullSync, runIncrementalSync } from './pr-sync-ops';
import { upsertBatch } from './pr-upsert';

export class PrSyncEngine {
  private readonly kv = new KV<PrKvSchema>('pr');
  private readonly _inflight = new Map<string, Promise<void>>();
  private readonly _controllers = new Map<string, AbortController>();
  private readonly _singleInflight = new Map<string, Promise<void>>();
  private readonly _checksInflight = new Map<string, Promise<void>>();
  private readonly _reviewsInflight = new Map<string, Promise<void>>();

  constructor(private readonly getOctokit: () => Promise<Octokit>) {}

  sync(repositoryUrl: string): void {
    const key = `sync:${repositoryUrl}`;
    if (this._inflight.has(key)) {
      log.info('PrSyncEngine: sync already in flight, skipping', { repositoryUrl });
      return;
    }

    const ctrl = new AbortController();
    this._controllers.set(repositoryUrl, ctrl);

    const emitProgress = (p: PrSyncProgress) => this._emitProgress(p);

    const promise = this._getFullSyncCursor(repositoryUrl)
      .then((cursor) => {
        if (ctrl.signal.aborted) return;
        return cursor?.done
          ? runIncrementalSync(repositoryUrl, ctrl.signal, this.kv, this.getOctokit, emitProgress)
          : runFullSync(repositoryUrl, ctrl.signal, this.kv, this.getOctokit, emitProgress, (url) =>
              this._archiveOldPrs(url)
            );
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncEngine: sync failed', { repositoryUrl, error: String(e) });
        }
      })
      .finally(() => {
        this._controllers.delete(repositoryUrl);
        this._inflight.delete(key);
      });

    this._inflight.set(key, promise);
  }

  forceFullSync(repositoryUrl: string): void {
    this.cancel(repositoryUrl);
    void Promise.all([
      this.kv.del(`fullsync:${repositoryUrl}`),
      this.kv.del(`incrementalsync:${repositoryUrl}`),
    ]).then(() => this.sync(repositoryUrl));
  }

  cancel(repositoryUrl: string): void {
    const ctrl = this._controllers.get(repositoryUrl);
    if (ctrl) {
      ctrl.abort();
      this._controllers.delete(repositoryUrl);
      this._inflight.delete(`sync:${repositoryUrl}`);
    }
  }

  async deleteProjectData(projectId: string): Promise<void> {
    log.info('PrSyncEngine: deleteProjectData', { projectId });

    const remoteRows = await db
      .select({ remoteUrl: projectRemotes.remoteUrl })
      .from(projectRemotes)
      .where(eq(projectRemotes.projectId, projectId));

    if (remoteRows.length === 0) return;

    for (const { remoteUrl: url } of remoteRows) {
      this.cancel(url);

      const shared = await db
        .select({ projectId: projectRemotes.projectId })
        .from(projectRemotes)
        .where(and(eq(projectRemotes.remoteUrl, url), ne(projectRemotes.projectId, projectId)))
        .limit(1);

      if (shared.length > 0) {
        log.info(
          'PrSyncEngine: deleteProjectData — remote shared with other project, skipping data cleanup',
          { url }
        );
        continue;
      }

      log.info('PrSyncEngine: deleteProjectData — deleting PR rows and KV cursors', { url });
      await db.delete(pullRequests).where(eq(pullRequests.repositoryUrl, url));
      await Promise.all([
        this.kv.del(`fullsync:${url}`),
        this.kv.del(`incrementalsync:${url}`),
        this.kv.del(`users-synced-at:${url}`),
      ]);
    }
  }

  // ── Single PR sync ────────────────────────────────────────────────────────

  async syncSingle(repositoryUrl: string, prNumber: number): Promise<PullRequest | null> {
    const key = `single:${repositoryUrl}:${prNumber}`;
    if (this._singleInflight.has(key)) {
      await this._singleInflight.get(key);
      return null;
    }

    const ctrl = new AbortController();
    let result: PullRequest | null = null;

    const promise = this._runSyncSingle(repositoryUrl, prNumber, ctrl.signal)
      .then((pr) => {
        result = pr;
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncEngine: syncSingle failed', {
            repositoryUrl,
            prNumber,
            error: String(e),
          });
        }
      })
      .finally(() => {
        this._singleInflight.delete(key);
      });

    this._singleInflight.set(key, promise);
    await promise;
    return result;
  }

  private async _runSyncSingle(
    repositoryUrl: string,
    prNumber: number,
    signal: AbortSignal
  ): Promise<PullRequest | null> {
    if (signal.aborted) return null;

    const repository = parseGitHubRepositoryResult(repositoryUrl);
    if (!repository.success) return null;
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit();

    const response = await withRetry(() =>
      githubRateLimiter.acquire().then(() =>
        octokit.graphql<{
          repository: { pullRequest: GqlPrNode | null };
        }>(GET_PR_BY_NUMBER_QUERY, { owner, repo, number: prNumber })
      )
    );

    const node = response.repository.pullRequest;
    if (!node) return null;

    const [pr] = await upsertBatch(repositoryUrl, [node]);
    if (pr) {
      this._notifyPrUpdated(pr);
    }

    this._emitProgress({ remoteUrl: repositoryUrl, kind: 'single', status: 'done', synced: 1 });
    return pr ?? null;
  }

  // ── Check runs sync ───────────────────────────────────────────────────────

  async syncChecks(pullRequestUrl: string, headRefOid: string): Promise<boolean> {
    const key = `checks:${pullRequestUrl}:${headRefOid}`;
    if (this._checksInflight.has(key)) {
      await this._checksInflight.get(key);
      return false;
    }

    const ctrl = new AbortController();
    let result = false;

    const promise = runSyncChecks(pullRequestUrl, headRefOid, ctrl.signal, this.getOctokit)
      .then((r) => {
        result = r;
      })
      .then(async () => {
        const assembled = await notifyPrWithChecks(pullRequestUrl);
        if (assembled) this._notifyPrUpdated(assembled);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncEngine: syncChecks failed', { pullRequestUrl, error: String(e) });
        }
      })
      .finally(() => {
        this._checksInflight.delete(key);
      });

    this._checksInflight.set(key, promise);
    await promise;
    return result;
  }

  // ── Reviews sync ──────────────────────────────────────────────────────────

  async syncReviews(pullRequestUrl: string): Promise<void> {
    const key = `reviews:${pullRequestUrl}`;
    if (this._reviewsInflight.has(key)) {
      await this._reviewsInflight.get(key);
      return;
    }

    const promise = runSyncReviews(pullRequestUrl, this.getOctokit)
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncEngine: syncReviews failed', { pullRequestUrl, error: String(e) });
        }
      })
      .finally(() => {
        this._reviewsInflight.delete(key);
      });

    this._reviewsInflight.set(key, promise);
    await promise;
  }

  // ── Users sync ────────────────────────────────────────────────────────────

  async syncUsers(repositoryUrl: string): Promise<void> {
    const tsKey = `users-synced-at:${repositoryUrl}`;
    const lastSync = (await this.kv.get(tsKey)) as string | null;
    if (lastSync) {
      const age = Date.now() - new Date(lastSync).getTime();
      if (age < 24 * 60 * 60 * 1000) return;
    }
    await this.kv.set(tsKey, new Date().toISOString());
  }

  // ── Mutation helpers (for controller use) ──────────────────────────────────

  async createPullRequest(params: {
    repositoryUrl: string;
    head: string;
    base: string;
    title: string;
    body?: string;
    draft: boolean;
  }): Promise<Result<{ url: string; number: number }, GitHubRepositoryParseError>> {
    const repository = parseGitHubRepositoryResult(params.repositoryUrl);
    if (!repository.success) return repository;
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit();
    const response = await octokit.rest.pulls.create({
      owner,
      repo,
      head: params.head,
      base: params.base,
      title: params.title,
      body: params.body,
      draft: params.draft,
    });
    const { html_url: url, number } = response.data;
    return ok({ url, number });
  }

  async mergePullRequest(
    repositoryUrl: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ): Promise<Result<{ sha: string | null; merged: boolean }, GitHubRepositoryParseError>> {
    const repository = parseGitHubRepositoryResult(repositoryUrl);
    if (!repository.success) return repository;
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit();
    const response = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: options.strategy,
      sha: options.commitHeadOid,
    });
    return ok({ sha: response.data.sha ?? null, merged: response.data.merged });
  }

  async markReadyForReview(
    repositoryUrl: string,
    prNumber: number
  ): Promise<Result<void, GitHubRepositoryParseError>> {
    const repository = parseGitHubRepositoryResult(repositoryUrl);
    if (!repository.success) return repository;
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit();
    const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    await octokit.graphql(
      `mutation MarkReadyForReview($id: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }`,
      { id: data.node_id }
    );
    return ok();
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    prNumber: number
  ): Promise<Result<PullRequestFile[], GitHubRepositoryParseError>> {
    const repository = parseGitHubRepositoryResult(repositoryUrl);
    if (!repository.success) return repository;
    const { owner, repo } = repository.data;
    const octokit = await this.getOctokit();
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return ok(
      files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      }))
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _archiveOldPrs(repositoryUrl: string): Promise<void> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - PR_ARCHIVE_AGE_MONTHS);
    const cutoffIso = cutoff.toISOString();

    await db
      .delete(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryUrl, repositoryUrl),
          inArray(pullRequests.status, ['closed', 'merged']),
          lt(pullRequests.pullRequestUpdatedAt, cutoffIso)
        )
      );

    log.info('PrSyncEngine: archived old PRs', { repositoryUrl, cutoffIso });
  }

  private _notifyPrUpdated(pr: PullRequest): void {
    events.emit(prUpdatedChannel, { prs: [pr] });
  }

  private _emitProgress(progress: PrSyncProgress): void {
    events.emit(prSyncProgressChannel, progress);
  }

  private async _getFullSyncCursor(repositoryUrl: string): Promise<{ done: boolean } | null> {
    return (await this.kv.get(`fullsync:${repositoryUrl}`)) as FullSyncCursor | null;
  }
}

export const prSyncEngine = new PrSyncEngine(getOctokit);
