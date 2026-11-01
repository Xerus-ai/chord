import type { BranchPublication } from '@shared/git';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { planPullRequestPush, readGitConfig } from './pull-request-push';

async function runGit(ctx: IExecutionContext, args: string[]): Promise<string> {
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

/** Whether `refs/remotes/<shortRef>` exists; git answers a missing one with exit 1. */
async function remoteRefExists(ctx: IExecutionContext, shortRef: string): Promise<boolean> {
  try {
    await runGit(ctx, ['show-ref', '--verify', '--quiet', `refs/remotes/${shortRef}`]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

/**
 * The remote-tracking ref (short form, `origin/chord/x`) Chord's Push writes
 * the branch to, in the order `push` and `publishBranch` (git-remote-ops.ts)
 * choose it:
 *  1. a fork PR checkout's explicit target (`planPullRequestPush`);
 *  2. git's own push destination, `%(push)` — set once published with `-u`;
 *  3. otherwise `<branch.<b>.remote | preferred remote>/<branch>`, where
 *     Publish and Push's `--set-upstream` retry put it. This also covers a
 *     branch pushed from a terminal without `-u`.
 * A branch tracking some other branch (`--track origin/main`) is not pushed
 * there, so `@{upstream}` is never used.
 */
async function resolvePushTarget(
  ctx: IExecutionContext,
  branch: string,
  preferredRemote: string
): Promise<string> {
  const plan = await planPullRequestPush(ctx, branch);
  if (plan.kind === 'explicit') {
    return `${plan.remote}/${plan.refspec.slice('HEAD:refs/heads/'.length)}`;
  }
  const pushShort = await runGit(ctx, [
    'for-each-ref',
    '--format=%(push:short)',
    `refs/heads/${branch}`,
  ]);
  if (pushShort) return pushShort;
  const remote = (await readGitConfig(ctx, `branch.${branch}.remote`)) ?? preferredRemote;
  return `${remote}/${branch}`;
}

/**
 * The branch's remote copy — the remote-tracking ref (short form) Push writes
 * it to — or null when there is none yet. The one definition both the ahead
 * count here and Settings › Git's upstream compare base
 * (`lane-compare-base.ts`) read, so the two cannot disagree (devstation-ama).
 */
export async function readBranchRemoteCopy(
  ctx: IExecutionContext,
  branch: string,
  preferredRemote: string = DEFAULT_REMOTE_NAME
): Promise<string | null> {
  const target = await resolvePushTarget(ctx, branch, preferredRemote);
  return (await remoteRefExists(ctx, target)) ? target : null;
}

/**
 * Where the checked-out branch stands against the remote, and how many of its
 * commits that remote does not have. Published: commits after the remote copy.
 * Otherwise: commits no remote has at all, so a lane forked from `origin/main`
 * with no work of its own counts 0 and still reads unpublished, and in a
 * repository with no remote every commit counts.
 */
export async function readBranchPublication(
  ctx: IExecutionContext,
  preferredRemote: string = DEFAULT_REMOTE_NAME
): Promise<{ publication: BranchPublication; aheadCount: number }> {
  const branch = await runGit(ctx, ['branch', '--show-current']);
  const remotes = (await runGit(ctx, ['remote'])).split('\n').filter(Boolean);

  let publication: BranchPublication;
  if (!branch) {
    publication = { kind: 'detached' };
  } else if (remotes.length === 0) {
    publication = { kind: 'no_remote' };
  } else {
    const remoteCopy = await readBranchRemoteCopy(ctx, branch, preferredRemote);
    publication = remoteCopy
      ? { kind: 'published', ref: remoteCopy }
      : { kind: 'unpublished', branch };
  }

  const countArgs =
    publication.kind === 'published'
      ? ['rev-list', '--count', `refs/remotes/${publication.ref}..HEAD`]
      : ['rev-list', '--count', 'HEAD', '--not', '--remotes'];
  const aheadCount = Number.parseInt(await runGit(ctx, countArgs), 10);
  if (!Number.isFinite(aheadCount)) {
    throw new Error(`git rev-list --count gave no number for ${countArgs.join(' ')}`);
  }
  return { publication, aheadCount };
}
