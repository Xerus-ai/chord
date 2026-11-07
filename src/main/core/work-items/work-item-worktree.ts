import type { RemoteBranchRef } from '@shared/create-from';
import type { Result } from '@shared/result';
import type { LaneProvisionError } from '@shared/work-item-provision-error';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { fastForwardLocalBase } from '@main/core/repo-config/fast-forward-local-base';
import { readJustMeSettings } from '@main/core/repo-config/resolve-repo-config';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import {
  provisionLaneCheckout,
  type LaneCheckoutRequest,
  type ProvisionedLane,
} from './lane-checkout';
import { resolveLanePoolPath } from './lane-pool-path';
import {
  preflightLaneRequest,
  type LanePreflightError,
  type LanePreflightRequest,
} from './lane-preflight';
import {
  createRemoteTrackingBranch,
  type RemoteTrackingBranchError,
} from './remote-tracking-branch';

/** Fetches carry the user's GitHub auth, so private remotes answer. */
function networkContextFor(repoPath: string): GitHubAuthExecutionContext {
  return new GitHubAuthExecutionContext(new LocalExecutionContext({ root: repoPath }), () =>
    githubConnectionService.getToken()
  );
}

/** The checks `createWorkItem` runs before writing anything (`lane-preflight.ts`). */
export function preflightWorkItemLane(args: {
  repoPath: string;
  request: LanePreflightRequest;
}): Promise<Result<void, LanePreflightError>> {
  return preflightLaneRequest({
    repoPath: args.repoPath,
    request: args.request,
    networkContext: networkContextFor(args.repoPath),
  });
}

/** A branch picked from a remote, made a local tracking branch before the preflight. */
export function createWorkItemTrackingBranch(args: {
  repoPath: string;
  localBranch: string;
  remote: RemoteBranchRef;
}): Promise<Result<void, RemoteTrackingBranchError>> {
  return createRemoteTrackingBranch({
    repoPath: args.repoPath,
    localBranch: args.localBranch,
    remote: args.remote.remote,
    branch: args.remote.branch,
    networkContext: networkContextFor(args.repoPath),
  });
}

/**
 * Acquiring the git checkout a lane runs in, from a `repos` row and this
 * machine's settings: the worktree root (Settings › General), the repo's
 * just-me base branch and companion repository, and GitHub auth for the
 * fetch. The git work itself is `lane-checkout.ts`.
 *
 * Checkouts live at `<pool>/<slug>`, the pool being the repository's own
 * folder or `<worktreeRoot>/<repo>` (`lane-pool-path.ts`).
 */
export async function provisionWorkItemWorktree(args: {
  repoPath: string;
  repoLabel: string;
  repoId: string | null;
  request: LaneCheckoutRequest;
  /** The user chose to fork from the base's last-fetched copy if its fetch fails. */
  allowLocalCopy: boolean;
  /** Retry of an interrupted create: use the checkout it left in the pool. */
  resumeInterrupted: boolean;
}): Promise<Result<ProvisionedLane, LaneProvisionError>> {
  const { defaultWorktreeDirectory } = await appSettingsService.get('localProject');
  const justMe = readJustMeSettings(args.repoId);
  const poolPath = resolveLanePoolPath({
    worktreeRoot: defaultWorktreeDirectory,
    repoLabel: args.repoLabel,
    repoId: args.repoId,
    justMeFolder: justMe.worktreeFolder,
  });

  const request: LaneCheckoutRequest =
    args.request.kind === 'new'
      ? { ...args.request, justMeBaseBranch: justMe.baseBranch }
      : args.request;

  const result = await provisionLaneCheckout({
    repoPath: args.repoPath,
    poolPath,
    request,
    companion: justMe.companionRepo,
    networkContext: networkContextFor(args.repoPath),
    allowLocalCopy: args.allowLocalCopy,
    resumeInterrupted: args.resumeInterrupted,
  });
  if (result.success) {
    log.info('[work-items] provisioned lane checkout', {
      branchName: result.data.branchName,
      worktreePath: result.data.worktreePath,
      targetRef: result.data.targetRef,
      forkSource: result.data.forkSource,
      companionPath: result.data.companionPath,
    });
    if (justMe.keepLocalBaseUpToDate && result.data.forkSource === 'fetched') {
      // The lane exists by now: a failure to move the user's own branch is
      // theirs to see in the log, not a reason to fail the lane (whose Retry
      // would then trip over its own branch).
      await fastForwardLocalBase(args.repoPath, result.data.targetRef).then(
        (outcome) =>
          log.info('[work-items] keep local base up to date', {
            targetRef: result.data.targetRef,
            outcome,
          }),
        (error: unknown) =>
          log.warn('[work-items] could not fast-forward the local base', {
            targetRef: result.data.targetRef,
            error: String(error),
          })
      );
    }
  }
  return result;
}
