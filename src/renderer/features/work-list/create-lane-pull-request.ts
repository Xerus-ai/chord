import type { QueryClient } from '@tanstack/react-query';
import { buildLanePrRequest, describeLanePrRequestError } from '@shared/lane-pull-requests';
import { pullRequestErrorMessage } from '@shared/pull-requests';
import { err, ok, type Result } from '@shared/result';
import { rpc } from '@renderer/lib/ipc';
import { describeRpcFailure } from './describe-action-failure';
import { commitAndPushWorkItem, invalidateWorktreeViews } from './use-commit-and-push';
import { invalidateLanePrViews } from './use-lane-pull-requests';

export interface CreateLanePrArgs {
  workItemId: string;
  workItemName: string;
  worktreeId: string;
  title: string;
  body: string;
  draft: boolean;
}

/**
 * Get the lane's branch onto the remote so GitHub can see a head to open the
 * PR from. A checkout with changes is committed first, under the work item's
 * name; a clean one is pushed as-is, which a commit cannot do (it fails on a
 * clean tree). Returns the failure, or null.
 */
async function publishLaneBranch(
  args: CreateLanePrArgs,
  queryClient: QueryClient
): Promise<string | null> {
  const status = await rpc.workItems.getGitStatus(args.workItemId, args.worktreeId);
  if (!status.success) return describeRpcFailure('Read repository status', status.error);
  if (status.data.files.length > 0) {
    return commitAndPushWorkItem(args.workItemId, args.workItemName, queryClient, args.worktreeId);
  }
  const pushed = await rpc.workItems.pushBranch(args.workItemId, args.worktreeId);
  if (!pushed.success) return describeRpcFailure('Push', pushed.error);
  // The band reads the lane's publication from its git log; without this it
  // kept offering Publish beside the PR it had just opened.
  await invalidateWorktreeViews(queryClient, args.workItemId);
  return null;
}

/**
 * Opens a pull request from one lane: its branch into its target_ref, under
 * the title and body from the form. The lane is read fresh, not from the
 * form's cache, so a PR opened meanwhile (here or on GitHub) is refused rather
 * than duplicated. Only the primary's PR is mirrored on the work item
 * (`work_items.pr_*`, the cloud's copy); every other lane's is derived.
 */
export async function createLanePullRequest(
  args: CreateLanePrArgs,
  queryClient: QueryClient
): Promise<Result<{ number: number; url: string }, string>> {
  const lanes = await rpc.pullRequests.getLanePullRequests(args.workItemId);
  if (!lanes.success) return err(pullRequestErrorMessage(lanes.error));
  const lane = lanes.data.lanes.find((row) => row.worktreeId === args.worktreeId);
  if (!lane) return err('This branch is no longer part of the work item.');

  const request = buildLanePrRequest({
    repositoryUrl: lanes.data.repositoryUrl,
    lane,
    title: args.title,
    body: args.body,
    draft: args.draft,
  });
  if (!request.success) return err(describeLanePrRequestError(request.error));

  const publishFailure = await publishLaneBranch(args, queryClient);
  if (publishFailure) return err(publishFailure);

  const created = await rpc.pullRequests.createPullRequest(request.data);
  if (!created.success) return err(describeRpcFailure('Create pull request', created.error));

  if (lane.isPrimary) {
    // The header chip, Merge and the sidebar badge read the derived PR; the
    // cloud and a teammate's view read this mirror.
    const linked = await rpc.workItems.update({
      id: args.workItemId,
      prNumber: created.data.number,
      prUrl: created.data.url,
    });
    if (!linked.success) {
      return err(
        `Pull request #${created.data.number} was created, but this work item could not be linked to it.`
      );
    }
  }

  await invalidateLanePrViews(queryClient, args.workItemId);
  return ok(created.data);
}
