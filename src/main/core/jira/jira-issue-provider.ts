import { ISSUE_PROVIDER_CAPABILITIES } from '@shared/issue-providers';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { jiraConnectionService } from './jira-connection-service';
import { getJiraIssue } from './jira-issue-lookup';
import { listJiraIssues, searchJiraIssues } from './jira-issue-queries';

const NOT_CONNECTED = 'Jira credentials not set. Connect Jira in Settings › Integrations first.';

export const jiraIssueProvider: IssueProvider = {
  type: 'jira',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,

  checkConnection: () => jiraConnectionService.checkConnection(),

  listIssues: async (opts) => {
    const auth = await jiraConnectionService.readAuth();
    if (!auth) return { success: false, error: NOT_CONNECTED };
    return listJiraIssues(auth, opts.limit ?? 50);
  },

  searchIssues: async (opts) => {
    const auth = await jiraConnectionService.readAuth();
    if (!auth) return { success: false, error: NOT_CONNECTED };
    return searchJiraIssues(auth, opts.searchTerm, opts.limit ?? 20);
  },

  getIssue: async (ref) => {
    if (ref.provider !== 'jira') throw new Error(`Jira cannot look up a ${ref.provider} issue`);
    return getJiraIssue(await jiraConnectionService.readAuth(), ref.key);
  },
};
