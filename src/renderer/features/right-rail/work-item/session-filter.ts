/**
 * Filtering session rows inside ONE work item's map.
 *
 * Deliberately small. A richer filter (Workspace/Project/All scopes, `repo:` and
 * `path:` prefixes, agent facets) belongs to a cross-repo browser over an
 * on-disk transcript store, a different job with a different data source. This
 * map is already scoped to one work item, which is the reason it is a map and
 * not a browser. Growing this into that would undo the reason the Sessions tab
 * was retired.
 *
 * So: free terms against what identifies a session to a human (its title, the
 * line it last said, the model it ran), and `branch:` for the one axis the map
 * groups by. Nothing else.
 */

/** The fields of one session row a query can match. */
export interface SessionFilterCandidate {
  title: string | null;
  preview: string | null;
  /** The branch of the worktree this session runs in. */
  branch: string | null;
  model: string | null;
}

export interface ParsedSessionQuery {
  terms: string[];
  branchTerms: string[];
}

/**
 * Below this many sessions across all worktrees the box does not appear: a
 * two-session work item does not need a search field, and an always-present
 * one is a row of chrome above the thing the user came to click.
 */
export const SESSION_FILTER_MIN_ROWS = 8;

const BRANCH_PREFIX = 'branch:';

/**
 * A bare `branch:` contributes nothing rather than an empty term — an empty
 * term would substring-match every branch, so typing the prefix before the
 * value would flash the full list as though the filter had been cleared.
 */
export function parseSessionQuery(query: string): ParsedSessionQuery {
  const terms: string[] = [];
  const branchTerms: string[] = [];

  for (const token of query.toLowerCase().split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith(BRANCH_PREFIX)) {
      const value = token.slice(BRANCH_PREFIX.length);
      if (value) branchTerms.push(value);
      continue;
    }
    terms.push(token);
  }

  return { terms, branchTerms };
}

/**
 * Every term must match, and a term must be found whole inside ONE field —
 * matching across a title and a preview joined together would make hits
 * impossible to explain from what is on screen.
 *
 * The branch is not in the free-term haystack: it has its own prefix, and
 * letting a bare word match it too would make `branch:` decoration.
 */
export function sessionMatchesQuery(
  candidate: SessionFilterCandidate,
  parsed: ParsedSessionQuery
): boolean {
  const branch = candidate.branch?.toLowerCase() ?? null;
  if (parsed.branchTerms.length > 0) {
    if (branch === null) return false;
    if (!parsed.branchTerms.every((term) => branch.includes(term))) return false;
  }

  if (parsed.terms.length === 0) return true;

  const fields = [candidate.title, candidate.preview, candidate.model]
    .filter((field): field is string => Boolean(field))
    .map((field) => field.toLowerCase());

  return parsed.terms.every((term) => fields.some((field) => field.includes(term)));
}
