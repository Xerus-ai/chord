import { desc, or } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import type { ListPrOptions, PullRequestError } from '@shared/pull-requests';
import { err, ok } from '@shared/result';
import type { PullRequestRef } from '@shared/work-item-ticket';
import { readConnectedOctokit } from '@main/core/github/services/octokit-provider';
import { likeContains } from '@main/core/utils/sql-like';
import { db } from '@main/db/client';
import { pullRequests } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { readLanePullRequests } from './lane-pull-requests';
import {
  createPullRequest,
  markPullRequestReadyForReview,
  mergePullRequest,
  readPullRequestFiles,
  type CreatePullRequestParams,
} from './pr-mutations';
import { prQueryService } from './pr-query-service';
import { prSyncEngine } from './pr-sync-engine';
import {
  readWorkItemChecks,
  readWorkItemReviews,
  syncWorkItemChecks,
  syncWorkItemReviews,
} from './pr-work-item-reads';
import { resolvePullRequestCheckout } from './resolve-pull-request-checkout';

function checksError(error: unknown, message: string) {
  return err<PullRequestError>({
    type: 'checks_failed',
    message: error instanceof Error ? error.message : message,
  });
}

export const pullRequestController = createRPCController({
  /** A pasted PR URL in the create dialog: its head, and the branch it checks out into here. */
  getPullRequestCheckout: (args: PullRequestRef & { repoId: string | null }) =>
    resolvePullRequestCheckout(args, readConnectedOctokit),

  // ── DB-cached reads ────────────────────────────────────────────────────────

  searchAll: (args: { query: string; limit?: number }) => {
    const rows = db
      .select({
        url: pullRequests.url,
        title: pullRequests.title,
        identifier: pullRequests.identifier,
        status: pullRequests.status,
        isDraft: pullRequests.isDraft,
        headRefName: pullRequests.headRefName,
      })
      .from(pullRequests)
      .where(
        or(
          likeContains(pullRequests.title, args.query),
          likeContains(pullRequests.identifier, args.query)
        )
      )
      .orderBy(desc(pullRequests.pullRequestUpdatedAt))
      .limit(args.limit ?? 10)
      .all();
    return ok({ prs: rows });
  },

  listPullRequests: async (projectId: string, options?: ListPrOptions) => {
    try {
      const prs = await prQueryService.listPullRequests(projectId, options);
      return ok({ prs, totalCount: prs.length });
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      return err<PullRequestError>({
        type: 'list_failed',
        message: error instanceof Error ? error.message : 'Unable to list pull requests',
      });
    }
  },

  getFilterOptions: async (projectId: string) => {
    try {
      const options = await prQueryService.getFilterOptions(projectId);
      return ok(options);
    } catch (error) {
      log.error('Failed to get PR filter options:', error);
      return err<PullRequestError>({
        type: 'filter_options_failed',
        message: error instanceof Error ? error.message : 'Unable to get filter options',
      });
    }
  },

  // ── Sync triggers ──────────────────────────────────────────────────────────

  forceFullSyncPullRequests: async (projectId: string) => {
    try {
      const capability = await prQueryService.getProjectRemoteInfo(projectId);
      if (capability.status !== 'ready') {
        return err<PullRequestError>({ type: 'remote_not_ready', status: capability.status });
      }
      prSyncEngine.forceFullSync(capability.repositoryUrl);
      return ok();
    } catch (error) {
      log.error('Failed to force full sync:', error);
      return err<PullRequestError>({
        type: 'sync_failed',
        message: error instanceof Error ? error.message : 'Unable to force sync',
      });
    }
  },

  syncPullRequests: async (projectId: string) => {
    try {
      log.info('PrController: syncPullRequests called', { projectId });
      const capability = await prQueryService.getProjectRemoteInfo(projectId);
      if (capability.status !== 'ready') {
        log.warn('PrController: remote not ready, skipping sync', {
          projectId,
          status: capability.status,
        });
        return err<PullRequestError>({ type: 'remote_not_ready', status: capability.status });
      }
      log.info('PrController: triggering sync', {
        projectId,
        repositoryUrl: capability.repositoryUrl,
      });
      prSyncEngine.sync(capability.repositoryUrl);
      return ok();
    } catch (error) {
      log.error('Failed to trigger sync:', error);
      return err<PullRequestError>({
        type: 'sync_failed',
        message: error instanceof Error ? error.message : 'Unable to sync',
      });
    }
  },

  refreshPullRequest: async (repositoryUrl: string, prNumber: number) => {
    try {
      const pr = await prSyncEngine.syncSingle(repositoryUrl, prNumber);
      return ok({ pr });
    } catch (error) {
      log.error('Failed to refresh pull request:', error);
      return err<PullRequestError>({
        type: 'refresh_failed',
        message: error instanceof Error ? error.message : 'Unable to refresh pull request',
      });
    }
  },

  syncChecks: async (pullRequestUrl: string, headRefOid: string) => {
    try {
      const hasRunning = await prSyncEngine.syncChecks(pullRequestUrl, headRefOid);
      return ok({ hasRunning });
    } catch (error) {
      log.error('Failed to sync checks:', error);
      return checksError(error, 'Unable to sync checks');
    }
  },

  cancelSync: (repositoryUrl: string) => {
    prSyncEngine.cancel(repositoryUrl);
    return ok();
  },

  // ── Lane-scoped checks & reviews (no worktreeId: the primary lane) ────────

  getChecksForWorkItem: async (workItemId: string, worktreeId?: string) => {
    try {
      return ok(await readWorkItemChecks(workItemId, worktreeId));
    } catch (error) {
      log.error('Failed to get checks for work item:', error);
      return checksError(error, 'Unable to get checks');
    }
  },

  syncChecksForWorkItem: async (workItemId: string, worktreeId?: string) => {
    try {
      return ok(await syncWorkItemChecks(workItemId, worktreeId));
    } catch (error) {
      log.error('Failed to sync checks for work item:', error);
      return checksError(error, 'Unable to sync checks');
    }
  },

  getReviewsForWorkItem: async (workItemId: string, worktreeId?: string) => {
    try {
      return ok({ reviews: await readWorkItemReviews(workItemId, worktreeId) });
    } catch (error) {
      log.error('Failed to get reviews for work item:', error);
      return checksError(error, 'Unable to get reviews');
    }
  },

  syncReviewsForWorkItem: async (workItemId: string, worktreeId?: string) => {
    try {
      return ok(await syncWorkItemReviews(workItemId, worktreeId));
    } catch (error) {
      log.error('Failed to sync reviews for work item:', error);
      return checksError(error, 'Unable to sync reviews');
    }
  },

  /**
   * Every live lane of the work item with its PR, its PR base and the GitHub
   * repository its branches push to — what the band, Create PR, the header's
   * PR list and Merge read.
   */
  getLanePullRequests: async (workItemId: string) => {
    try {
      const lanes = await readLanePullRequests(workItemId);
      if (!lanes) return err<PullRequestError>({ type: 'work_item_not_found' });
      return ok(lanes);
    } catch (error) {
      log.error('Failed to read lane pull requests:', error);
      return err<PullRequestError>({
        type: 'lanes_failed',
        message: error instanceof Error ? error.message : 'Unable to read lane pull requests',
      });
    }
  },

  // ── Mutations ──────────────────────────────────────────────────────────────

  createPullRequest: (params: CreatePullRequestParams) => createPullRequest(params),

  mergePullRequest: (
    repositoryUrl: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ) => mergePullRequest(repositoryUrl, prNumber, options),

  markReadyForReview: (repositoryUrl: string, prNumber: number) =>
    markPullRequestReadyForReview(repositoryUrl, prNumber),

  // ── Pass-through reads ─────────────────────────────────────────────────────

  getPullRequestFiles: (repositoryUrl: string, prNumber: number) =>
    readPullRequestFiles(repositoryUrl, prNumber),
});
