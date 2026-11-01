import type {
  ConnectionStatus,
  IssueListResult,
  IssueProviderCapabilities,
} from '@shared/issue-providers';
import type { Result } from '@shared/result';
import type { Issue } from '@shared/tasks';
import type { IssueLookupError, IssueRef, WorkItemTicket } from '@shared/work-item-ticket';

export type IssueQueryOpts = {
  limit?: number;
  projectId?: string;
  projectPath?: string;
  remote?: string;
  repositoryUrl?: string;
};

export type IssueSearchOpts = IssueQueryOpts & {
  searchTerm: string;
};

export interface IssueProvider {
  readonly type: Issue['provider'];
  readonly capabilities: IssueProviderCapabilities;

  checkConnection(): Promise<ConnectionStatus>;
  listIssues(opts: IssueQueryOpts): Promise<IssueListResult>;
  searchIssues(opts: IssueSearchOpts): Promise<IssueListResult>;
  /** One ticket, for the create dialog. Only called with a ref of this provider. */
  getIssue(ref: IssueRef): Promise<Result<WorkItemTicket, IssueLookupError>>;
}
