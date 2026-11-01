import { err, ok, type Result } from './result';

/**
 * A pull request belongs to a lane, not to the work item (plan 2026-09-26 P8).
 * Nothing about it is stored on the lane: it is derived by matching
 * `pull_requests.head_ref_name` and the head repository to the lane's branch
 * in the checkout's GitHub repository. `work_items.pr_*` stays only as the
 * cloud's mirror of the primary lane's PR.
 */

/** CI on the PR's current head commit (`deriveChecksState`). */
export type LaneChecksState = 'passing' | 'failing' | 'pending' | 'none';

export interface LanePr {
  number: number;
  url: string;
  title: string;
  /** GitHub's state, lower-cased on sync: 'open' | 'merged' | 'closed'. */
  status: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  mergeableStatus: string | null;
  reviewDecision: string | null;
  checks: LaneChecksState;
}

export interface LanePullRequest {
  worktreeId: string;
  branchName: string | null;
  isPrimary: boolean;
  /** Where this lane's PR merges, e.g. `origin/main`; null when it could not be resolved. */
  targetRef: string | null;
  /** `targetRef` as GitHub names the base branch: without the remote. */
  prBase: string | null;
  /** Why the target could not be resolved; null when it was. */
  targetError: string | null;
  pr: LanePr | null;
}

export interface WorkItemLanePullRequests {
  /** The GitHub repository the work item's checkout pushes to; null when it has none. */
  repositoryUrl: string | null;
  /** Live lanes, primary first. */
  lanes: LanePullRequest[];
}

/**
 * `<remote>/<branch>` split at the remote that prefixes it. The longest remote
 * name wins (`up/stream/main` with remotes `up` and `up/stream`); a ref no
 * remote prefixes is a local branch, and null.
 */
export function splitRemoteRef(
  ref: string,
  remotes: readonly string[]
): { remote: string; branch: string } | null {
  const remote = remotes
    .filter((name) => ref.startsWith(`${name}/`) && ref.length > name.length + 1)
    .sort((a, b) => b.length - a.length)[0];
  if (remote === undefined) return null;
  return { remote, branch: ref.slice(remote.length + 1) };
}

export interface LanePrRequest {
  repositoryUrl: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

export type LanePrRequestError =
  | { type: 'pr_exists'; number: number; url: string }
  | { type: 'no_github_remote' }
  | { type: 'no_branch' }
  | { type: 'no_target'; message: string }
  | { type: 'on_target'; branch: string }
  | { type: 'empty_title' };

/**
 * The pull request Create PR opens for a lane: from the lane's branch into its
 * target, under the title and body the user wrote.
 */
export function buildLanePrRequest(args: {
  repositoryUrl: string | null;
  lane: LanePullRequest;
  title: string;
  body: string;
  draft: boolean;
}): Result<LanePrRequest, LanePrRequestError> {
  const { lane } = args;
  if (lane.pr) return err({ type: 'pr_exists', number: lane.pr.number, url: lane.pr.url });
  if (args.repositoryUrl === null) return err({ type: 'no_github_remote' });
  if (lane.branchName === null) return err({ type: 'no_branch' });
  if (lane.prBase === null) {
    if (lane.targetError === null) {
      throw new Error(`Lane ${lane.worktreeId} has neither a PR base nor a reason it has none`);
    }
    return err({ type: 'no_target', message: lane.targetError });
  }
  if (lane.branchName === lane.prBase) return err({ type: 'on_target', branch: lane.branchName });
  const title = args.title.trim();
  if (!title) return err({ type: 'empty_title' });
  return ok({
    repositoryUrl: args.repositoryUrl,
    head: lane.branchName,
    base: lane.prBase,
    title,
    body: args.body,
    draft: args.draft,
  });
}

export function describeLanePrRequestError(error: LanePrRequestError): string {
  switch (error.type) {
    case 'pr_exists':
      return `This branch already has pull request #${error.number}.`;
    case 'no_github_remote':
      return 'This repository has no GitHub remote Chord can open a pull request against.';
    case 'no_branch':
      return 'This branch is on a detached HEAD. Check out a branch first.';
    case 'no_target':
      return error.message;
    case 'on_target':
      return `This branch is ${error.branch}, the branch it would merge into. Move the work to its own branch first.`;
    case 'empty_title':
      return 'Give the pull request a title.';
  }
}
