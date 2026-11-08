import { selectPreferredRemote } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type { LaneProvisionError } from '@shared/work-item-provision-error';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { readGitFailureOutput } from '@main/core/git/git-failure-output';
import { findBranchCheckout } from '@main/core/projects/worktrees/find-branch-checkout';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { branchNotFoundError } from './lane-checkout';
import { branchCheckedOutError } from './lane-checkout-placement';

/**
 * What `createWorkItem` checks before it writes anything: the failures the
 * user can only fix by changing what they asked for. They reach the create
 * dialog, which stays open — a work item that exists only to show a
 * validation error, with a Retry that cannot succeed, is the wrong artifact.
 *
 * A branch or base this clone already knows is checked without network, so
 * the common case is instant. Only one it has never seen is looked up on the
 * remote (and fetched, so provisioning finds it). The slow, transient steps —
 * fetching a known base, `git worktree add`, setup — stay in provisioning.
 */

export type LanePreflightRequest =
  | { kind: 'new'; baseRef?: string }
  | { kind: 'existing'; branchName: string };

export type LanePreflightError =
  | Extract<LaneProvisionError, { type: 'branch_checked_out' | 'branch_not_found' }>
  | Extract<LaneProvisionError, { type: 'base_not_found' }>
  /** The remote could not be asked whether it has `ref`; `gitOutput` is what git said. */
  | { type: 'fetch_failed'; ref: string; message: string; gitOutput: string };

const REMOTE_TIMEOUT_MS = 60_000;
/** `git ls-remote --exit-code`: the remote answered, and has no matching ref. */
const LS_REMOTE_NO_MATCH = 2;

type RemoteLookup = 'found' | 'missing' | { failure: string };

class PreflightGit {
  constructor(
    readonly local: IExecutionContext,
    private readonly network: IExecutionContext
  ) {}

  async refExists(ref: string): Promise<boolean> {
    return this.local.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', '--quiet', ref]).then(
      () => true,
      () => false
    );
  }

  async remotes(): Promise<string[]> {
    const { stdout } = await this.local.exec(GIT_EXECUTABLE, ['remote']);
    return stdout
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean);
  }

  /** Asks `remote` for `branch`, and fetches it into `refs/remotes/<remote>/` when it has it. */
  async lookUpOnRemote(remote: string, branch: string): Promise<RemoteLookup> {
    try {
      await this.network.exec(
        GIT_EXECUTABLE,
        ['ls-remote', '--exit-code', remote, `refs/heads/${branch}`],
        { timeout: REMOTE_TIMEOUT_MS }
      );
    } catch (error) {
      if ((error as { code?: unknown }).code === LS_REMOTE_NO_MATCH) return 'missing';
      return { failure: readGitFailureOutput(error) };
    }
    try {
      await this.network.exec(
        GIT_EXECUTABLE,
        ['fetch', '--no-tags', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
        { timeout: REMOTE_TIMEOUT_MS }
      );
    } catch (error) {
      return { failure: readGitFailureOutput(error) };
    }
    return 'found';
  }
}

/**
 * Whether `name` names a branch here or on the preferred remote, in any
 * spelling a user types: `main`, `origin/main`.
 */
async function locateBranch(gitOps: PreflightGit, name: string): Promise<RemoteLookup> {
  const remotes = await gitOps.remotes();
  const prefixed = remotes.find((remote) => name.startsWith(`${remote}/`));
  if (prefixed && (await gitOps.refExists(`refs/remotes/${name}`))) return 'found';
  if (await gitOps.refExists(`refs/heads/${name}`)) return 'found';
  if (remotes.length === 0) return 'missing';

  const remote =
    prefixed ??
    selectPreferredRemote(
      undefined,
      remotes.map((r) => ({ name: r, url: '' }))
    ).name;
  const branch = prefixed ? name.slice(remote.length + 1) : name;
  if (await gitOps.refExists(`refs/remotes/${remote}/${branch}`)) return 'found';
  return gitOps.lookUpOnRemote(remote, branch);
}

export async function preflightLaneRequest(args: {
  /** The repository's main checkout. */
  repoPath: string;
  request: LanePreflightRequest;
  /** Runs the remote lookups; pass one carrying GitHub auth. */
  networkContext?: IExecutionContext;
}): Promise<Result<void, LanePreflightError>> {
  const local = new LocalExecutionContext({ root: args.repoPath });
  const gitOps = new PreflightGit(local, args.networkContext ?? local);
  const { request } = args;

  if (request.kind === 'existing') {
    // Registrations left by checkouts deleted outside git would otherwise
    // report the branch as still checked out there.
    await local.exec(GIT_EXECUTABLE, ['worktree', 'prune']);
    const holder = await findBranchCheckout(local, request.branchName);
    if (holder) return err(branchCheckedOutError(request.branchName, holder));
    const located = await locateBranch(gitOps, request.branchName);
    if (located === 'found') return ok(undefined);
    if (located === 'missing') return err(branchNotFoundError(request.branchName));
    return err({
      type: 'fetch_failed',
      ref: request.branchName,
      message: `Could not ask the remote for ${request.branchName}.`,
      gitOutput: located.failure,
    });
  }

  if (request.baseRef === undefined) return ok(undefined);
  const located = await locateBranch(gitOps, request.baseRef);
  if (located === 'found') return ok(undefined);
  if (located === 'missing') {
    return err({
      type: 'base_not_found',
      ref: request.baseRef,
      message: `Base branch ${request.baseRef} was not found in this repository or on its remote.`,
    });
  }
  return err({
    type: 'fetch_failed',
    ref: request.baseRef,
    message: `Could not ask the remote for ${request.baseRef}.`,
    gitOutput: located.failure,
  });
}
