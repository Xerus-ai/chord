import { err, ok, type Result } from '@shared/result';
import type { LaneProvisionError } from '@shared/work-item-provision-error';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { readGitConfig } from '@main/core/git/impl/pull-request-push';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

export type RemoteTrackingBranchError =
  | Extract<LaneProvisionError, { type: 'branch_exists' | 'branch_not_found' }>
  /** The remote could not be asked for the branch, or the fetch failed. */
  | { type: 'fetch_failed'; ref: string; message: string };

const REMOTE_TIMEOUT_MS = 60_000;
/** `git ls-remote --exit-code`: the remote answered, and has no matching ref. */
const LS_REMOTE_NO_MATCH = 2;

function describe(error: unknown): string {
  const stderr = (error as { stderr?: string } | null)?.stderr;
  return stderr?.trim() || (error instanceof Error ? error.message : String(error));
}

/**
 * A branch picked from a remote in Create from… (plan §Phase 3 slice 2)
 * becomes `localBranch`, tracking `<remote>/<branch>`, before the create
 * preflight runs — as a fork PR's branch is fetched first
 * (`pull-request-checkout.ts`) — so the preflight, the checkout and a Retry
 * all see one ordinary local branch. The name was planned by the listing
 * (`create-from/plan-tracking-branch.ts`); a local branch of that name is
 * kept only when it already tracks the same branch, and is never overwritten.
 * The user's checkout is never switched.
 */
export async function createRemoteTrackingBranch(args: {
  repoPath: string;
  localBranch: string;
  remote: string;
  branch: string;
  /** Runs the remote lookup and fetch; pass one carrying GitHub auth. */
  networkContext?: IExecutionContext;
}): Promise<Result<void, RemoteTrackingBranchError>> {
  const { localBranch, remote, branch } = args;
  const local = new LocalExecutionContext({ root: args.repoPath });
  const network = args.networkContext ?? local;
  const remoteName = `${remote}/${branch}`;
  const run = (args: string[]) => local.exec(GIT_EXECUTABLE, args);

  const exists = await run(['rev-parse', '--verify', '--quiet', `refs/heads/${localBranch}`]).then(
    () => true,
    () => false
  );
  if (exists) {
    const trackedRemote = await readGitConfig(local, `branch.${localBranch}.remote`);
    const trackedMerge = await readGitConfig(local, `branch.${localBranch}.merge`);
    if (trackedRemote === remote && trackedMerge === `refs/heads/${branch}`) return ok();
    return err({
      type: 'branch_exists',
      branch: localBranch,
      message: `A local branch ${localBranch} already exists and doesn't track ${remoteName}, so ${remoteName} can't be checked out as it.`,
    });
  }

  try {
    await network.exec(
      GIT_EXECUTABLE,
      ['ls-remote', '--exit-code', remote, `refs/heads/${branch}`],
      { timeout: REMOTE_TIMEOUT_MS }
    );
  } catch (error) {
    if ((error as { code?: unknown }).code === LS_REMOTE_NO_MATCH) {
      return err({
        type: 'branch_not_found',
        branch: remoteName,
        message: `Branch ${branch} was not found on ${remote}.`,
      });
    }
    return err({
      type: 'fetch_failed',
      ref: remoteName,
      message: `Could not ask ${remote} for ${branch}. ${describe(error)}`,
    });
  }
  const trackingRef = `refs/remotes/${remote}/${branch}`;
  try {
    await network.exec(
      GIT_EXECUTABLE,
      ['fetch', '--no-tags', remote, `+refs/heads/${branch}:${trackingRef}`],
      { timeout: REMOTE_TIMEOUT_MS }
    );
  } catch (error) {
    return err({
      type: 'fetch_failed',
      ref: remoteName,
      message: `Could not fetch ${remoteName}. ${describe(error)}`,
    });
  }
  // Written key by key rather than `--track <remote>/<branch>`, which resolves
  // to a local branch `upstream/main` itself once one exists under that name.
  await run(['branch', '--no-track', localBranch, trackingRef]);
  await run(['config', `branch.${localBranch}.remote`, remote]);
  await run(['config', `branch.${localBranch}.merge`, `refs/heads/${branch}`]);
  return ok();
}
