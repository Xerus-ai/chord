import type {
  BranchPick,
  ListBranchPicksError,
  ListPullRequestPicksError,
  PullRequestPick,
} from '@shared/create-from';
import type { Result } from '@shared/result';
import type { Issue } from '@shared/tasks';
import { TICKET_PROVIDERS, type TicketProvider } from '@shared/work-item-ticket';

/**
 * What each tab of Create from… shows: its rows, the search within it, and a
 * real empty or not-connected state — never sample data, and never an empty
 * list standing in for a failure.
 */

export type TabView<Row> =
  | { status: 'loading' }
  /** `message` is null when the tab's notices already say why it is empty. */
  | { status: 'empty'; message: string | null }
  | { status: 'error'; message: string }
  | { status: 'rows'; rows: Row[] };

export type IssueSource =
  | { provider: TicketProvider; status: 'loading' }
  | { provider: TicketProvider; status: 'not_connected' }
  /** GitHub, for a repository with no GitHub remote. */
  | { provider: TicketProvider; status: 'no_repository' }
  | { provider: TicketProvider; status: 'error'; message: string }
  | { provider: TicketProvider; status: 'ready'; issues: Issue[] };

export const PROVIDER_LABELS: Record<TicketProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
};

const SETTINGS_PATH = 'Settings › Integrations';

/** Branches are searched here: the listing is the whole repository's. */
export function viewBranchesTab(input: {
  result: Result<BranchPick[], ListBranchPicksError> | null;
  query: string;
}): TabView<BranchPick> {
  const { result } = input;
  if (!result) return { status: 'loading' };
  if (!result.success) return { status: 'error', message: result.error.message };
  if (result.data.length === 0) {
    return { status: 'empty', message: 'This repository has no branches yet.' };
  }
  const query = input.query.trim().toLowerCase();
  const rows = query
    ? result.data.filter((pick) => pick.name.toLowerCase().includes(query))
    : result.data;
  if (rows.length === 0) {
    return { status: 'empty', message: `No branches match “${input.query.trim()}”.` };
  }
  return { status: 'rows', rows };
}

/** Pull requests are searched on GitHub: `result` already answers the query. */
export function viewPullRequestsTab(input: {
  result: Result<PullRequestPick[], ListPullRequestPicksError> | null;
  query: string;
}): TabView<PullRequestPick> {
  const { result } = input;
  if (!result) return { status: 'loading' };
  if (!result.success) {
    switch (result.error.type) {
      case 'no_github_remote':
        return {
          status: 'empty',
          message: 'This repository has no GitHub remote, so it has no pull requests to pick.',
        };
      case 'not_connected':
        return {
          status: 'empty',
          message: `GitHub isn't connected. Connect it in ${SETTINGS_PATH} to pick a pull request.`,
        };
      case 'no_repo':
      case 'error':
        return { status: 'error', message: result.error.message };
    }
  }
  if (result.data.length > 0) return { status: 'rows', rows: result.data };
  const query = input.query.trim();
  return {
    status: 'empty',
    message: query ? `No open pull requests match “${query}”.` : 'No open pull requests.',
  };
}

function describeNotice(source: IssueSource): string | null {
  const label = PROVIDER_LABELS[source.provider];
  if (source.status === 'no_repository') {
    return `${label}: this repository has no GitHub remote, so ${label} has no issues for it.`;
  }
  if (source.status === 'error') return `${label}: couldn't list issues — ${source.message}`;
  return null;
}

/** Issues are searched in each tracker: every source already answers the query. */
export function viewIssuesTab(input: { sources: IssueSource[] | null; query: string }): {
  view: TabView<Issue>;
  notices: string[];
} {
  if (!input.sources) return { view: { status: 'loading' }, notices: [] };
  const order = (provider: TicketProvider) => TICKET_PROVIDERS.indexOf(provider);
  const connected = input.sources
    .filter((source) => source.status !== 'not_connected')
    .sort((a, b) => order(a.provider) - order(b.provider));
  if (connected.length === 0) {
    return {
      view: {
        status: 'empty',
        message: `No issue tracker is connected. Connect GitHub, Linear or Jira in ${SETTINGS_PATH}.`,
      },
      notices: [],
    };
  }

  const notices = connected.map(describeNotice).filter((notice): notice is string => !!notice);
  const rows = connected.flatMap((source) => (source.status === 'ready' ? source.issues : []));
  if (rows.length > 0) return { view: { status: 'rows', rows }, notices };
  if (connected.some((source) => source.status === 'loading')) {
    return { view: { status: 'loading' }, notices };
  }
  // Every tracker failed or has no repository, and its notice says so.
  if (!connected.some((source) => source.status === 'ready')) {
    return { view: { status: 'empty', message: null }, notices };
  }
  const query = input.query.trim();
  return {
    view: {
      status: 'empty',
      message: query ? `No open issues match “${query}”.` : 'No open issues.',
    },
    notices,
  };
}
