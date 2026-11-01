import type { RemoteBranchRef } from './create-from';

/**
 * Tickets and pull requests as the create path sees them (plan §Phase 3
 * slice 1): what a ticket lookup answers, what a pasted PR URL resolves to,
 * and the ticket a work item is created with.
 */

export type TicketProvider = 'github' | 'linear' | 'jira';

export const TICKET_PROVIDERS: readonly TicketProvider[] = ['github', 'linear', 'jira'];

/** A work item's ticket. `title` and `url` are null when the lookup couldn't read them. */
export interface WorkItemTicket {
  provider: TicketProvider;
  id: string;
  url: string | null;
  title: string | null;
}

/** A ticket to look up. A GitHub issue is read in the owner/repo its URL names. */
export type IssueRef =
  | { provider: 'github'; owner: string; repo: string; number: number }
  | { provider: 'linear'; key: string }
  | { provider: 'jira'; key: string };

export type IssueLookupError = {
  type: 'not_connected' | 'not_found' | 'error';
  message: string;
};

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

/** Everything `gh pr checkout` needs to know about a PR's head. */
export interface PullRequestHead {
  number: number;
  title: string;
  url: string;
  headRef: string;
  headOwner: string;
  /** `owner/name`; null when the fork was deleted. */
  headRepo: string | null;
  headCloneUrl: string | null;
  crossRepository: boolean;
  maintainerCanModify: boolean;
}

export type PullRequestHeadError = {
  type: 'not_connected' | 'not_found' | 'error';
  message: string;
};

/** A fork PR to fetch from its repository's `refs/pull/<n>/head` into the lane's branch. */
export interface PullRequestCheckoutSource {
  number: number;
  headRef: string;
  headOwner: string;
  headCloneUrl: string | null;
  maintainerCanModify: boolean;
  /** The remote that is the PR's repository: the one its pull ref is fetched from. */
  baseRemote: string;
}

/** What the create dialog shows for a pasted PR: its head and the local branch planned for it. */
export interface PullRequestCheckout extends PullRequestHead {
  branch: string;
  /**
   * The remote that is the PR's repository. A PR whose repository is none of
   * the clone's remotes has no checkout (`repository_not_a_remote`).
   */
  baseRemote: string;
  /**
   * A same-repository PR whose repository isn't the preferred remote:
   * `branch` is made tracking its head there, as a picked remote branch is.
   */
  tracking?: RemoteBranchRef;
}

export type PullRequestCheckoutError =
  | { type: 'branch_exists'; branch: string; message: string }
  | { type: 'pull_ref_not_found'; message: string }
  | { type: 'fork_fetch_failed'; message: string }
  | { type: 'remote_name_taken'; remote: string; message: string }
  | { type: 'error'; message: string };
