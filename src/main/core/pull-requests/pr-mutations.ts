import { RequestError } from '@octokit/request-error';
import type { PullRequestError, PullRequestFile } from '@shared/pull-requests';
import { err, ok, type Result } from '@shared/result';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';
import { prSyncEngine } from './pr-sync-engine';

export interface CreatePullRequestParams {
  repositoryUrl: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  draft: boolean;
}

/**
 * GitHub reports the actionable reason ("No commits between main and x",
 * "A pull request already exists") inside `response.data.errors`; the top-level
 * Error message is only ever "Validation Failed".
 */
function describeGithubFailure(error: unknown, fallback: string): string {
  const errors =
    error instanceof RequestError &&
    Array.isArray((error.response?.data as { errors?: unknown[] } | undefined)?.errors)
      ? (error.response!.data as { errors: { message?: string }[] }).errors
      : undefined;
  return errors?.[0]?.message ?? (error instanceof Error ? error.message : fallback);
}

export async function createPullRequest(
  params: CreatePullRequestParams
): Promise<Result<{ url: string; number: number }, PullRequestError>> {
  try {
    const result = await prSyncEngine.createPullRequest(params);
    if (!result.success) {
      return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
    }
    // The lane, header and band read PRs from the DB; return only once the new
    // one is there, or the caller's refresh reads the table without it.
    await prSyncEngine.syncSingle(params.repositoryUrl, result.data.number);
    capture('pr_created', { is_draft: params.draft });
    return ok({ url: result.data.url, number: result.data.number });
  } catch (error) {
    log.error('Failed to create pull request:', error);
    capture('pr_creation_failed', {
      error_type: error instanceof Error ? error.name || 'error' : 'unknown_error',
    });
    return err<PullRequestError>({
      type: 'create_failed',
      message: describeGithubFailure(error, 'Unable to create pull request'),
    });
  }
}

export async function mergePullRequest(
  repositoryUrl: string,
  prNumber: number,
  options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
): Promise<Result<{ sha: string | null; merged: boolean }, PullRequestError>> {
  try {
    const result = await prSyncEngine.mergePullRequest(repositoryUrl, prNumber, options);
    if (!result.success) {
      return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
    }
    // As for create: the band shows Merged only once the row says so.
    await prSyncEngine.syncSingle(repositoryUrl, prNumber);
    return ok({ sha: result.data.sha, merged: result.data.merged });
  } catch (error) {
    log.error('Failed to merge pull request:', error);
    return err<PullRequestError>({
      type: 'merge_failed',
      message: describeGithubFailure(error, 'Unable to merge pull request'),
    });
  }
}

export async function markPullRequestReadyForReview(
  repositoryUrl: string,
  prNumber: number
): Promise<Result<void, PullRequestError>> {
  try {
    const result = await prSyncEngine.markReadyForReview(repositoryUrl, prNumber);
    if (!result.success) {
      return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
    }
    void prSyncEngine.syncSingle(repositoryUrl, prNumber);
    return ok();
  } catch (error) {
    log.error('Failed to mark pull request ready for review:', error);
    return err<PullRequestError>({
      type: 'mark_ready_failed',
      message: describeGithubFailure(error, 'Unable to mark PR ready for review'),
    });
  }
}

export async function readPullRequestFiles(
  repositoryUrl: string,
  prNumber: number
): Promise<Result<{ files: PullRequestFile[] }, PullRequestError>> {
  try {
    const result = await prSyncEngine.getPullRequestFiles(repositoryUrl, prNumber);
    if (!result.success) {
      return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
    }
    return ok({ files: result.data });
  } catch (error) {
    log.error('Failed to get pull request files:', error);
    return err<PullRequestError>({
      type: 'files_failed',
      message: error instanceof Error ? error.message : 'Unable to get pull request files',
    });
  }
}
