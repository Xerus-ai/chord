/**
 * The single derivation of a pull request's state from its synced row. The
 * sidebar row (main) and each lane's PR row (renderer) both read it, so the
 * ladder lives in shared code rather than being re-typed per surface.
 *
 * Two layers: `derivePrState` IS the ladder and yields the typed state other
 * code branches on; `derivePrBadge` is a mapping from that state to the word
 * a header prints. A surface that needs to act on the state must never parse
 * the word back.
 *
 * `status` is normalised to lower-case on upsert, but `mergeableStatus` and
 * `reviewDecision` are stored as GitHub's GraphQL enums (upper-case).
 */
import type { PullRequestState } from './pull-requests';

export interface PrBadgeInput {
  status: string;
  /** `pull_requests.is_draft` (0/1) as stored, or the boolean a lane's PR carries. */
  isDraft: number | boolean | null;
  mergeableStatus: string | null;
  reviewDecision: string | null;
}

export type PrBadge =
  | 'Merged'
  | 'Closed'
  | 'Draft'
  | 'Conflicts'
  | 'Changes requested'
  | 'Ready to merge'
  | 'In review';

export function derivePrState(pr: PrBadgeInput): PullRequestState {
  if (pr.status === 'merged') return 'merged';
  if (pr.status === 'closed') return 'closed';
  if (pr.isDraft) return 'draft';
  if (pr.mergeableStatus === 'CONFLICTING') return 'conflicts';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested';
  if (pr.reviewDecision === 'APPROVED') return 'ready_to_merge';
  return 'in_review';
}

const BADGE_WORD: Record<PullRequestState, PrBadge> = {
  merged: 'Merged',
  closed: 'Closed',
  draft: 'Draft',
  conflicts: 'Conflicts',
  changes_requested: 'Changes requested',
  ready_to_merge: 'Ready to merge',
  in_review: 'In review',
};

export function derivePrBadge(pr: PrBadgeInput): PrBadge {
  return BADGE_WORD[derivePrState(pr)];
}
