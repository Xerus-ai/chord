import type { RemoteBranchRef } from './create-from';
import type { PullRequestCheckoutSource, WorkItemTicket } from './work-item-ticket';

/** The one request every create surface sends (`rpc.workItems.create`). */
export interface CreateWorkItemArgs {
  /** Chosen by the dialog so the branch it previews is the branch created. A UUID. */
  id?: string;
  /** Stored exactly as sent: the dialog shows it before Create. */
  name: string;
  repoId?: string;
  repoPath?: string;
  repoAlias?: string;
  /** Fork point for a new chord-named branch. Omit for the repository's default base. */
  baseRef?: string;
  /** Check out this existing branch instead of creating one. Excludes `baseRef`. */
  existingBranch?: string;
  /** A fork PR whose pull ref is fetched into `existingBranch` before anything is written. */
  pullRequest?: PullRequestCheckoutSource;
  /** A branch picked from a remote: `existingBranch` is created tracking it before anything is written. */
  trackRemoteBranch?: RemoteBranchRef;
  /** Written in the same transaction as the work item. */
  ticket?: WorkItemTicket;
  status?: string;
  agentProvider?: string;
}
