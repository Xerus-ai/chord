import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { pullRequestErrorMessage } from '@shared/pull-requests';
import {
  canMergeLanePr,
  selectFocusedLane,
} from '@renderer/features/right-rail/band/lane-band-input';
import { rpc } from '@renderer/lib/ipc';
import { describeThrownFailure } from './describe-action-failure';
import { invalidateLanePrViews, useLanePullRequests } from './use-lane-pull-requests';

type PendingPrAction = 'merge' | 'request-review' | null;

/** GitHub's three merge methods, as `pullRequests.mergePullRequest` takes them. */
export type MergeStrategy = 'merge' | 'squash' | 'rebase';

/**
 * Every PR action for one lane's pull request, in one place. Three surfaces
 * render them — the band, the Checks panel and the in-chat PR card — and the
 * semantics that make them safe (the headRefOid merge pin, offering an action
 * only while GitHub would accept it) must not diverge between them.
 *
 * `worktreeId` names the lane; null means no lane (still loading, or a PR no
 * lane of this work item holds), and then there is nothing to act on.
 */
export function useLanePrActions(workItemId: string | undefined, worktreeId: string | null) {
  const queryClient = useQueryClient();
  const { data: lanes, error: loadError } = useLanePullRequests(workItemId);
  const [pending, setPending] = useState<PendingPrAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const lane = selectFocusedLane(lanes, worktreeId);
  const pr = lane?.pr ?? null;
  const repositoryUrl = lanes?.repositoryUrl ?? null;

  const refreshPrViews = useCallback(async () => {
    if (!workItemId) return;
    await invalidateLanePrViews(queryClient, workItemId);
  }, [queryClient, workItemId]);

  const openPr = useCallback((url: string | null) => {
    if (!url) return;
    rpc.app.openExternal(url).catch((error: unknown) => {
      setActionError(describeThrownFailure('Open pull request', error));
    });
  }, []);

  const merge = useCallback(
    async (strategy: MergeStrategy = 'merge') => {
      if (!pr || !repositoryUrl || pending) return;

      setPending('merge');
      try {
        // headRefOid pins the merge to the commit this UI is showing: if the
        // branch moved since the last sync GitHub refuses instead of merging
        // work the user never saw.
        const result = await rpc.pullRequests.mergePullRequest(repositoryUrl, pr.number, {
          strategy,
          commitHeadOid: pr.headRefOid,
        });
        if (!result.success) {
          setActionError(`Merge failed: ${pullRequestErrorMessage(result.error)}`);
          return;
        }
        if (!result.data.merged) {
          setActionError('Merge failed: GitHub did not merge this pull request');
          return;
        }
        setActionError(null);
        await refreshPrViews();
      } catch (error) {
        setActionError(describeThrownFailure('Merge', error));
      } finally {
        setPending(null);
      }
    },
    [pr, repositoryUrl, pending, refreshPrViews]
  );

  /**
   * Requesting review on a draft is GitHub's own "Ready for review": it takes
   * the PR out of draft, which is what notifies reviewers and code owners.
   * A PR that is already out of draft has nothing to request — the button
   * says so rather than sending a call GitHub would reject.
   */
  const requestReview = useCallback(async () => {
    if (!pr || !repositoryUrl || pending) return;

    setPending('request-review');
    try {
      const result = await rpc.pullRequests.markReadyForReview(repositoryUrl, pr.number);
      if (!result.success) {
        setActionError(`Request review failed: ${pullRequestErrorMessage(result.error)}`);
        return;
      }
      setActionError(null);
      await refreshPrViews();
    } catch (error) {
      setActionError(describeThrownFailure('Request review', error));
    } finally {
      setPending(null);
    }
  }, [pr, repositoryUrl, pending, refreshPrViews]);

  return {
    lane,
    pr,
    repositoryUrl,
    prUrl: pr?.url ?? null,
    canMerge: canMergeLanePr(pr, repositoryUrl),
    canRequestReview: !!pr && !!repositoryUrl && pr.status === 'open' && pr.isDraft,
    merging: pending === 'merge',
    requestingReview: pending === 'request-review',
    merge,
    requestReview,
    openPr,
    error: actionError ?? (loadError instanceof Error ? loadError.message : null),
  };
}
