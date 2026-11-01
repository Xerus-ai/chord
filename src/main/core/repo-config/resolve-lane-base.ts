import { selectPreferredRemote } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type { ForkSource } from '@shared/worktrees';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { readGitFailureOutput } from '@main/core/git/git-failure-output';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { readTeamConfigAtRef, RepoConfigError } from './read-team-config';

/**
 * Where a new lane forks from, and where its PR will merge.
 *
 * The fork point is never "whatever the main checkout has checked out": that
 * stacks every new branch on the user's in-progress work and on a base nobody
 * fetched. It is, in order, the base the user asked for, their just-me
 * override, the team file's `baseBranch`, then the remote's default branch —
 * fetched first, so the lane starts from what the team has now.
 */

export interface LaneBase {
  /** `origin/main` for a remote base, `main` for a local-only one. */
  targetRef: string;
  forkSha: string;
  forkSource: ForkSource;
}

export type ResolveLaneBaseError =
  | { type: 'base_not_found'; ref: string; message: string }
  /**
   * The base has a last-fetched copy, but fetching it failed — offline, or the
   * branch left the remote; git cannot tell which. Forking from the copy is the
   * user's call (`allowLocalCopy`), never made for them.
   */
  | {
      type: 'base_fetch_failed';
      ref: string;
      lastFetchedSha: string;
      message: string;
      /** What git said, shown folded under `message` (devstation-kcvy). */
      gitOutput: string;
    }
  | { type: 'remote_default_unknown'; remote: string; message: string }
  | { type: 'config_invalid'; message: string };

type NamedBase =
  | { ref: string; source: Exclude<ForkSource, 'local_copy'>; fetchFailure: null }
  /** A last-fetched copy, because its fetch failed: what git said. */
  | { ref: string; source: 'local_copy'; fetchFailure: string };

type LocalCopyBase = Extract<NamedBase, { source: 'local_copy' }>;

const FETCH_TIMEOUT_MS = 60_000;

class LaneGit {
  constructor(
    private readonly local: IExecutionContext,
    private readonly network: IExecutionContext
  ) {}

  async run(args: string[]): Promise<string> {
    return (await this.local.exec(GIT_EXECUTABLE, args)).stdout.trim();
  }

  async succeeds(args: string[]): Promise<boolean> {
    return this.run(args).then(
      () => true,
      () => false
    );
  }

  async remotes(): Promise<{ name: string; url: string }[]> {
    const names = (await this.run(['remote'])).split('\n').filter(Boolean);
    return names.map((name) => ({ name, url: '' }));
  }

  /** Updates `refs/remotes/<remote>/<branch>`; what git said, when the fetch failed. */
  async fetchBranch(remote: string, branch: string): Promise<{ failure: string | null }> {
    try {
      await this.network.exec(
        GIT_EXECUTABLE,
        ['fetch', '--no-tags', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
        { timeout: FETCH_TIMEOUT_MS }
      );
      return { failure: null };
    } catch (error) {
      log.info('[lanes] fetch failed', { remote, branch, error: String(error) });
      return { failure: readGitFailureOutput(error) };
    }
  }

  async remoteDefaultBranch(remote: string): Promise<string | null> {
    const read = () =>
      this.run(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]).then(
        (ref) => ref.slice(remote.length + 1) || null,
        () => null
      );
    const recorded = await read();
    if (recorded) return recorded;
    // A remote added by hand (rather than cloned) never recorded its HEAD.
    try {
      await this.network.exec(GIT_EXECUTABLE, ['remote', 'set-head', remote, '--auto'], {
        timeout: FETCH_TIMEOUT_MS,
      });
    } catch (error) {
      log.info('[lanes] could not ask the remote for its default branch', {
        remote,
        error: String(error),
      });
      return null;
    }
    return read();
  }
}

async function readTeamBaseBranch(
  repoPath: string,
  ref: string
): Promise<Result<{ baseBranch?: string; remote?: string }, ResolveLaneBaseError>> {
  try {
    const { config } = await readTeamConfigAtRef(repoPath, ref);
    return ok({ baseBranch: config.baseBranch, remote: config.remote });
  } catch (error) {
    if (error instanceof RepoConfigError) {
      return err({ type: 'config_invalid' as const, message: error.message });
    }
    throw error;
  }
}

async function resolveLocalOnlyBase(
  gitOps: LaneGit,
  args: { repoPath: string; baseRef?: string; justMeBaseBranch?: string }
): Promise<Result<LaneBase, ResolveLaneBaseError>> {
  // With no remote there is nothing upstream to be stale against: the branch
  // the repository itself is on is its default.
  const checkedOut = await gitOps.run(['symbolic-ref', '--short', 'HEAD']).catch(() => '');
  if (!checkedOut) {
    return err({
      type: 'base_not_found' as const,
      ref: 'HEAD',
      message:
        'This repository has no remote and its checkout is on a detached HEAD, so there is no default branch to start from. Check out a branch or choose a base branch.',
    });
  }
  const team = await readTeamBaseBranch(args.repoPath, checkedOut);
  if (!team.success) return team;

  const name = args.baseRef ?? args.justMeBaseBranch ?? team.data.baseBranch ?? checkedOut;
  if (!(await gitOps.succeeds(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]))) {
    return err({
      type: 'base_not_found' as const,
      ref: name,
      message: `Base branch ${name} does not exist in this repository.`,
    });
  }
  return ok({
    targetRef: name,
    forkSha: await gitOps.run(['rev-parse', `${name}^{commit}`]),
    forkSource: 'local',
  });
}

async function refuseLocalCopy(
  gitOps: LaneGit,
  copy: LocalCopyBase
): Promise<Result<never, ResolveLaneBaseError>> {
  return err({
    type: 'base_fetch_failed' as const,
    ref: copy.ref,
    lastFetchedSha: await gitOps.run(['rev-parse', `${copy.ref}^{commit}`]),
    message: `Could not fetch ${copy.ref}, so its newest commit is unknown.`,
    gitOutput: copy.fetchFailure,
  });
}

/**
 * `name` fetched from `remote` when the remote has it, else the local branch
 * of that name. A remote branch whose fetch failed resolves to its
 * last-fetched copy only with `allowLocalCopy`; otherwise the failure is
 * returned with the SHA that copy is at, so the user can choose it.
 */
async function resolveNamedBase(
  gitOps: LaneGit,
  remote: string,
  name: string,
  allowLocalCopy: boolean
): Promise<Result<NamedBase, ResolveLaneBaseError>> {
  const branch = name.startsWith(`${remote}/`) ? name.slice(remote.length + 1) : name;
  const { failure } = await gitOps.fetchBranch(remote, branch);
  const remoteRef = `${remote}/${branch}`;
  if (await gitOps.succeeds(['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}`])) {
    if (failure === null) return ok({ ref: remoteRef, source: 'fetched', fetchFailure: null });
    const copy: LocalCopyBase = { ref: remoteRef, source: 'local_copy', fetchFailure: failure };
    return allowLocalCopy ? ok(copy) : refuseLocalCopy(gitOps, copy);
  }
  if (await gitOps.succeeds(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) {
    return ok({ ref: branch, source: 'local', fetchFailure: null });
  }
  return err({
    type: 'base_not_found' as const,
    ref: name,
    message: `Base branch ${name} was not found on ${remote} or locally.`,
  });
}

/**
 * The ref a lane with no recorded target merges into, as this clone knows it
 * now — no branch fetch. `<remote>/<default>` when the repository has a
 * remote, else the branch its main checkout is on.
 */
export async function resolveDefaultBaseRef(
  repoPath: string,
  networkContext?: IExecutionContext
): Promise<Result<string, ResolveLaneBaseError>> {
  const local = new LocalExecutionContext({ root: repoPath });
  const gitOps = new LaneGit(local, networkContext ?? local);
  const remotes = await gitOps.remotes();
  if (remotes.length === 0) {
    const checkedOut = await gitOps.run(['symbolic-ref', '--short', 'HEAD']).catch(() => '');
    if (!checkedOut) {
      return err({
        type: 'base_not_found' as const,
        ref: 'HEAD',
        message: 'This repository has no remote and its checkout is on a detached HEAD.',
      });
    }
    return ok(checkedOut);
  }
  const remote = selectPreferredRemote(undefined, remotes).name;
  const defaultBranch = await gitOps.remoteDefaultBranch(remote);
  if (!defaultBranch) {
    return err({
      type: 'remote_default_unknown' as const,
      remote,
      message: `Could not find ${remote}'s default branch (${remote}/HEAD). Check that ${remote} is reachable.`,
    });
  }
  return ok(`${remote}/${defaultBranch}`);
}

export async function resolveLaneBase(args: {
  repoPath: string;
  /** What the user typed as the base, if anything. */
  baseRef?: string;
  justMeBaseBranch?: string;
  /** Runs the network calls (fetch); pass one with GitHub auth. Defaults to plain git. */
  networkContext?: IExecutionContext;
  /** The user chose to fork from the last-fetched copy when the fetch fails. */
  allowLocalCopy?: boolean;
}): Promise<Result<LaneBase, ResolveLaneBaseError>> {
  const local = new LocalExecutionContext({ root: args.repoPath });
  const gitOps = new LaneGit(local, args.networkContext ?? local);
  const allowLocalCopy = args.allowLocalCopy ?? false;

  const remotes = await gitOps.remotes();
  if (remotes.length === 0) return resolveLocalOnlyBase(gitOps, args);

  const remote = selectPreferredRemote(undefined, remotes).name;
  const defaultBranch = await gitOps.remoteDefaultBranch(remote);
  if (!defaultBranch) {
    return err({
      type: 'remote_default_unknown' as const,
      remote,
      message: `Could not find ${remote}'s default branch (${remote}/HEAD). Check that ${remote} is reachable, or choose a base branch.`,
    });
  }
  // Read with the copy allowed: until the requested base is known, the default
  // is only where the team file is read. It must be fresh only when it turns
  // out to be the base itself — checked below.
  const defaultRef = await resolveNamedBase(gitOps, remote, defaultBranch, true);
  if (!defaultRef.success) return defaultRef;

  const team = await readTeamBaseBranch(args.repoPath, defaultRef.data.ref);
  if (!team.success) return team;

  const requested = args.baseRef ?? args.justMeBaseBranch ?? team.data.baseBranch;
  const baseRemote =
    team.data.remote && remotes.some((r) => r.name === team.data.remote)
      ? team.data.remote
      : remote;
  let base: Result<NamedBase, ResolveLaneBaseError>;
  if (requested !== undefined) {
    base = await resolveNamedBase(gitOps, baseRemote, requested, allowLocalCopy);
  } else if (defaultRef.data.source === 'local_copy' && !allowLocalCopy) {
    base = await refuseLocalCopy(gitOps, defaultRef.data);
  } else {
    base = defaultRef;
  }
  if (!base.success) return base;

  return ok({
    targetRef: base.data.ref,
    forkSha: await gitOps.run(['rev-parse', `${base.data.ref}^{commit}`]),
    forkSource: base.data.source,
  });
}
