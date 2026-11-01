import type { Octokit } from '@octokit/rest';
import type { GitHubPullRequestListError, PullRequestPick } from '@shared/create-from';
import { err, ok, type Result } from '@shared/result';
import { describeGitHubFailure, readGitHubStatus } from './github-issue-lookup';

const DEFAULT_LIMIT = 50;

type RestPullRow = {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  user: { login: string } | null;
};

function toPick(repository: { owner: string; repo: string }, row: RestPullRow): PullRequestPick {
  return {
    owner: repository.owner,
    repo: repository.repo,
    number: row.number,
    title: row.title,
    url: row.html_url,
    authorLogin: row.user?.login ?? null,
    isDraft: row.draft === true,
  };
}

/**
 * The PRs tab of Create from…: a repository's open pull requests, read live
 * from GitHub, or searched there (`repo:<owner>/<repo> is:pr is:open`) when the
 * user types. Null `octokit` means GitHub isn't connected. A failure is named;
 * an empty list would read as "no pull requests".
 */
export async function listGitHubPullRequests(
  octokit: Octokit | null,
  repository: { owner: string; repo: string },
  opts: { searchTerm?: string; limit?: number }
): Promise<Result<PullRequestPick[], GitHubPullRequestListError>> {
  if (!octokit) return err({ type: 'not_connected', message: 'GitHub is not connected.' });
  const { owner, repo } = repository;
  const perPage = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 100);
  const term = opts.searchTerm?.trim();
  try {
    if (term) {
      const { data } = await octokit.rest.search.issuesAndPullRequests({
        q: `${term} repo:${owner}/${repo} is:pr is:open`,
        per_page: perPage,
        sort: 'updated',
        order: 'desc',
      });
      return ok(data.items.map((item) => toPick(repository, item as RestPullRow)));
    }
    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: perPage,
    });
    return ok(data.map((row) => toPick(repository, row)));
  } catch (error) {
    const status = readGitHubStatus(error);
    const message = describeGitHubFailure(error);
    if (status === 401) return err({ type: 'not_connected', message });
    if (status === 404) {
      return err({
        type: 'error',
        message: `GitHub has no repository ${owner}/${repo} this account can see.`,
      });
    }
    return err({ type: 'error', message });
  }
}
