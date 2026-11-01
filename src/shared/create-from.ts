/**
 * What Create from… lists (plan §Phase 3 slice 2): the repository's branches,
 * each with where it is checked out, and its open pull requests.
 */

/** Where a branch is checked out: git allows a branch in one worktree at a time. */
export type BranchHolder =
  /** The repository's main checkout, or a worktree Chord doesn't own. */
  | { kind: 'checkout'; path: string }
  /** A lane of a work item. */
  | { kind: 'work_item'; path: string; workItemId: string; workItemName: string };

/** A remote branch a new local branch is made to track. */
export interface RemoteBranchRef {
  remote: string;
  branch: string;
}

export interface BranchPick {
  /** As listed: a local branch, the preferred remote's branch by its own name, else `<remote>/<branch>`. */
  name: string;
  source: 'local' | 'remote';
  /** The remote of a remote branch; null for a local one. */
  remote: string | null;
  /** The local branch a checkout uses — what `existingBranch` carries. */
  localBranch: string;
  /** For a remote branch: the branch `localBranch` is created to track. */
  tracking: RemoteBranchRef | null;
  holder: BranchHolder | null;
}

export type ListBranchPicksError = { type: 'no_repo'; message: string };

export interface PullRequestPick {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  isDraft: boolean;
}

export type GitHubPullRequestListError =
  | { type: 'not_connected'; message: string }
  | { type: 'error'; message: string };

export type ListPullRequestPicksError =
  | { type: 'no_repo'; message: string }
  | { type: 'no_github_remote'; message: string }
  | GitHubPullRequestListError;
