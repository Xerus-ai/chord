import {
  toPullRequestRef,
  type NeedsYouPullRequestRef,
  type NeedsYouPullRequests,
  type PullRequestSearchNode,
} from '@shared/sidebar-summaries';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { githubRateLimiter } from '@main/lib/rate-limiter';
import { withRetry } from '@main/lib/retry';
import { githubConnectionService } from './github-connection-service';
import { getOctokit } from './octokit-provider';

/** Same cadence as `PrSyncScheduler`'s incremental PR sync. */
const NEEDS_YOU_PRS_TTL_MS = 5 * 60 * 1000;
const SEARCH_PAGE_SIZE = 100;

/** Open PRs, any repo, where the signed-in user (or a team they are on) is a
 * requested reviewer. */
const REVIEW_REQUESTED_QUERY = 'is:pr is:open archived:false review-requested:@me';
/** The user's own open PRs whose review decision is changes-requested. */
const CHANGES_REQUESTED_QUERY = 'is:pr is:open archived:false author:@me review:changes_requested';

const SEARCH_PULL_REQUESTS = `
  query NeedsYouPullRequests($searchQuery: String!, $first: Int!, $after: String) {
    search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          url
          number
          title
          repository { nameWithOwner }
          author { login }
        }
      }
    }
  }
`;

interface SearchResponse {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: PullRequestSearchNode[];
  };
}

async function searchPullRequests(query: string): Promise<NeedsYouPullRequestRef[]> {
  const octokit = await getOctokit();
  // Keyed so a PR on two result pages is listed once.
  const refs = new Map<string, NeedsYouPullRequestRef>();
  let after: string | null = null;
  do {
    const response: SearchResponse = await withRetry(() =>
      githubRateLimiter.acquire().then(() =>
        octokit.graphql<SearchResponse>(SEARCH_PULL_REQUESTS, {
          // octokit reserves `query` as the document's own key.
          searchQuery: query,
          first: SEARCH_PAGE_SIZE,
          after,
        })
      )
    );
    for (const node of response.search.nodes) {
      const ref = toPullRequestRef(node);
      if (ref) refs.set(ref.key, ref);
    }
    after = response.search.pageInfo.hasNextPage ? response.search.pageInfo.endCursor : null;
  } while (after);
  return [...refs.values()];
}

const cache = new TTLCache<NeedsYouPullRequests>(NEEDS_YOU_PRS_TTL_MS);

const NOT_CONNECTED: NeedsYouPullRequests = { reviewRequested: [], changesRequested: [] };

/**
 * PRs waiting on the signed-in GitHub user, cached for the PR sync cadence so
 * every window's sidebar query shares one GitHub round-trip. Without a GitHub
 * connection nothing can be requested of the user — an honest empty result,
 * not cached, so connecting shows reviews on the next poll.
 */
export async function getNeedsYouPullRequests(): Promise<NeedsYouPullRequests> {
  if (!(await githubConnectionService.isAuthenticated())) return NOT_CONNECTED;
  return cache.get(async () => {
    const [reviewRequested, changesRequested] = await Promise.all([
      searchPullRequests(REVIEW_REQUESTED_QUERY),
      searchPullRequests(CHANGES_REQUESTED_QUERY),
    ]);
    return { reviewRequested, changesRequested };
  });
}
