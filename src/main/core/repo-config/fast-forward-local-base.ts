import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Repo › General › "Keep local base up to date": once a lane has fetched its
 * base (`origin/main`), the user's own branch of that name (`main`) follows
 * it — by fast-forward only. A branch with commits of its own is left alone,
 * and so is one checked out anywhere: moving the ref under a working tree
 * would make every file the fetch changed look edited there.
 */

export type FastForwardOutcome =
  | 'updated'
  | 'up_to_date'
  | 'no_local_branch'
  | 'checked_out'
  | 'diverged'
  /** The base is a local branch, so there is no remote branch to follow. */
  | 'not_remote';

export async function fastForwardLocalBase(
  repoPath: string,
  targetRef: string
): Promise<FastForwardOutcome> {
  const git = new LocalExecutionContext({ root: repoPath });
  const run = async (args: string[]) => (await git.exec(GIT_EXECUTABLE, args)).stdout.trim();
  const succeeds = (args: string[]) =>
    run(args).then(
      () => true,
      () => false
    );

  const remotes = (await run(['remote'])).split('\n').filter(Boolean);
  const remote = remotes
    .filter((name) => targetRef.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!remote) return 'not_remote';
  const branch = targetRef.slice(remote.length + 1);
  const localRef = `refs/heads/${branch}`;

  if (!(await succeeds(['rev-parse', '--verify', '--quiet', localRef]))) return 'no_local_branch';
  const localSha = await run(['rev-parse', localRef]);
  const remoteSha = await run(['rev-parse', `refs/remotes/${targetRef}`]);
  if (localSha === remoteSha) return 'up_to_date';

  const worktrees = await run(['worktree', 'list', '--porcelain']);
  if (worktrees.split('\n').some((line) => line.trim() === `branch ${localRef}`)) {
    return 'checked_out';
  }
  if (!(await succeeds(['merge-base', '--is-ancestor', localSha, remoteSha]))) return 'diverged';

  // The old value guards the update: if the branch moved meanwhile, it fails.
  await run(['update-ref', localRef, remoteSha, localSha]);
  return 'updated';
}
