import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import type { BranchPick, PullRequestPick } from '@shared/create-from';
import type { IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { TICKET_PROVIDERS, type TicketProvider } from '@shared/work-item-ticket';
import { ISSUE_CONNECTION_STATUS_QUERY_KEY } from '@renderer/features/integrations/integrations-provider';
import { describeThrownFailure } from '@renderer/features/work-list/describe-action-failure';
import { rpc } from '@renderer/lib/ipc';
import {
  viewBranchesTab,
  viewIssuesTab,
  viewPullRequestsTab,
  type IssueSource,
  type TabView,
} from './create-from-tabs';
import { useDebouncedValue } from './use-debounced-value';

/**
 * The server data behind Create from…'s tabs, for the repository the create
 * dialog has selected. Each answers a `TabView` (`create-from-tabs.ts`).
 */

const SEARCH_DEBOUNCE_MS = 300;
const ISSUE_LIST_LIMIT = 50;
const ISSUE_SEARCH_LIMIT = 20;

/**
 * Re-read on every mount (no stale time): which branch is checked out where
 * changes as lanes come and go, and the holder decides what may be picked.
 */
export function useBranchPicks(repoId: string | null) {
  return useQuery({
    queryKey: ['create-from', 'branches', repoId],
    queryFn: () => rpc.createFrom.listBranches(repoId!),
    enabled: repoId !== null,
    retry: false,
  });
}

export function useBranchesTab(repoId: string | null, query: string): TabView<BranchPick> {
  const branches = useBranchPicks(repoId);
  if (branches.isError) {
    return { status: 'error', message: describeThrownFailure('List branches', branches.error) };
  }
  return viewBranchesTab({ result: branches.data ?? null, query });
}

export function usePullRequestsTab(repoId: string | null, query: string): TabView<PullRequestPick> {
  const term = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const pulls = useQuery({
    queryKey: ['create-from', 'pull-requests', repoId, term],
    queryFn: () =>
      rpc.createFrom.listPullRequests({ repoId: repoId!, searchTerm: term || undefined }),
    enabled: repoId !== null,
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  if (pulls.isError) {
    return { status: 'error', message: describeThrownFailure('List pull requests', pulls.error) };
  }
  return viewPullRequestsTab({ result: pulls.data ?? null, query: term });
}

function toIssueSource(
  provider: TicketProvider,
  query: { isPending: boolean; isError: boolean; error: unknown; data?: IssueListResult }
): IssueSource {
  if (query.isError) {
    return { provider, status: 'error', message: describeThrownFailure('List', query.error) };
  }
  if (query.isPending || !query.data) return { provider, status: 'loading' };
  return query.data.success
    ? { provider, status: 'ready', issues: query.data.issues }
    : { provider, status: 'error', message: query.data.error };
}

/** Every connected tracker's open issues; GitHub's from the repository's GitHub remote. */
export function useIssuesTab(
  repoId: string | null,
  query: string
): { view: TabView<Issue>; notices: string[] } {
  const term = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const connections = useQuery({
    queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY,
    queryFn: () => rpc.issues.checkAllConnections(),
    staleTime: 30_000,
  });
  const githubRepository = useQuery({
    queryKey: ['create-from', 'github-repository', repoId],
    queryFn: () => rpc.createFrom.readGitHubRepository(repoId!),
    enabled: repoId !== null,
    retry: false,
  });
  const repositoryUrl = githubRepository.data?.success
    ? githubRepository.data.data.repositoryUrl
    : null;

  const lists = useQueries({
    queries: TICKET_PROVIDERS.map((provider) => ({
      queryKey: [
        'create-from',
        'issues',
        provider,
        provider === 'github' ? repositoryUrl : null,
        term,
      ],
      queryFn: () => {
        const scope = provider === 'github' ? { repositoryUrl: repositoryUrl! } : {};
        return term
          ? rpc.issues.searchIssues(provider, {
              ...scope,
              searchTerm: term,
              limit: ISSUE_SEARCH_LIMIT,
            })
          : rpc.issues.listIssues(provider, { ...scope, limit: ISSUE_LIST_LIMIT });
      },
      enabled:
        connections.data?.[provider]?.connected === true &&
        (provider !== 'github' || repositoryUrl !== null),
      staleTime: 30_000,
      retry: false,
      placeholderData: keepPreviousData,
    })),
  });

  if (connections.isError) {
    const message = describeThrownFailure('Check issue connections', connections.error);
    return { view: { status: 'error', message }, notices: [] };
  }
  if (!connections.data) return viewIssuesTab({ sources: null, query: term });

  const sources = TICKET_PROVIDERS.map((provider, index): IssueSource => {
    if (connections.data[provider]?.connected !== true)
      return { provider, status: 'not_connected' };
    if (provider === 'github') {
      if (githubRepository.isError) {
        return {
          provider,
          status: 'error',
          message: describeThrownFailure('Read the GitHub remote', githubRepository.error),
        };
      }
      if (!githubRepository.data) return { provider, status: 'loading' };
      if (!githubRepository.data.success) {
        return { provider, status: 'error', message: githubRepository.data.error.message };
      }
      if (repositoryUrl === null) return { provider, status: 'no_repository' };
    }
    return toIssueSource(provider, lists[index]);
  });
  return viewIssuesTab({ sources, query: term });
}
