/**
 * `pull_request_checks.status` / `.conclusion` are the raw GitHub GraphQL
 * enum, upper-cased, exactly as `pr-checks-sync.ts` writes them (`status`:
 * 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED'; `conclusion`: 'SUCCESS' |
 * 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'TIMED_OUT' | 'ACTION_REQUIRED' |
 * 'SKIPPED' | 'STALE' | null while running).
 */
export interface CheckFacts {
  commitSha: string;
  status: string;
  conclusion: string | null;
}

const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * CI on the PR's current head commit, as four distinct facts. A sidebar row
 * has to tell "nothing is configured" from "still running" — one shows no
 * check signal at all, the other shows a pending one — while status
 * aggregation only ever asked "is it green?".
 */
export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

export function deriveChecksState(checks: readonly CheckFacts[], headRefOid: string): ChecksState {
  const onHead = checks.filter((check) => check.commitSha === headRefOid);
  if (onHead.length === 0) return 'none';
  if (onHead.some((check) => check.status !== 'COMPLETED')) return 'pending';
  return onHead.every(
    (check) => check.conclusion !== null && PASSING_CONCLUSIONS.has(check.conclusion)
  )
    ? 'passing'
    : 'failing';
}

/**
 * True when every check on the PR's current head commit passed, false when
 * any of them did not, null when there are no checks for that commit yet or
 * one is still running — "unknown", not "failing". The same ladder as
 * `deriveChecksState`, with its two unknown cases collapsed, so
 * `deriveWorkItemStatus` keeps reading one tri-state.
 */
export function deriveChecksPassing(
  checks: readonly CheckFacts[],
  headRefOid: string
): boolean | null {
  const state = deriveChecksState(checks, headRefOid);
  if (state === 'passing') return true;
  if (state === 'failing') return false;
  return null;
}
