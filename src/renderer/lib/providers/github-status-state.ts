/**
 * How much the current GitHub connection state can be trusted.
 *
 * - `known`   — the last check answered; `authenticated` is current.
 * - `stale`   — the last check failed but an earlier one answered, so
 *               `authenticated` is the last known good value. A transient
 *               failure must land here, never demote a connected account.
 * - `unknown` — the check failed and nothing was ever learned; `authenticated`
 *               carries no information and must not be rendered as
 *               "not connected".
 */
export type GithubStatusFreshness = 'known' | 'stale' | 'unknown';

export function resolveStatusFreshness(
  hasStatus: boolean,
  statusError: string | null
): GithubStatusFreshness {
  if (statusError === null) return 'known';
  return hasStatus ? 'stale' : 'unknown';
}
