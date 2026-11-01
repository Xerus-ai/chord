import type { IssueProviderType } from '@shared/issue-providers';
import { githubIssueProvider } from '@main/core/github/github-issue-provider';
import { jiraIssueProvider } from '@main/core/jira/jira-issue-provider';
import { linearIssueProvider } from '@main/core/linear/linear-issue-provider';
import type { IssueProvider } from './issue-provider';

const providers = new Map<IssueProviderType, IssueProvider>();

function register(provider: IssueProvider) {
  providers.set(provider.type, provider);
}

register(linearIssueProvider);
register(githubIssueProvider);
register(jiraIssueProvider);

export function getIssueProvider(type: IssueProviderType): IssueProvider | undefined {
  return providers.get(type);
}

export function getAllIssueProviders(): IssueProvider[] {
  return [...providers.values()];
}
