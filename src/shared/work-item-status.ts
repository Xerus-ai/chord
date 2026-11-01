/**
 * Pure status derivation shared by the sidebar, the Attention sort, and any
 * future surface that needs a work item's or worktree's bucket. See
 * the workspace shell redesign design, "Status
 * derivation", for the priority table this implements.
 *
 * Real vocabularies this derivation is built against:
 * - agent_sessions.status: only 'active' | 'suspended' | 'done' are written
 *   today (src/main/db/schema-work-items.ts:98, written in
 *   src/main/core/work-items/session-service.ts:69,97,135,336,418). The
 *   design table also names a session-status-error signal for the `failed`
 *   bucket, which nothing produces yet — the field is typed `string` (not a
 *   closed union) so `deriveWorktreeStatus` recognizes it the moment the
 *   data layer starts writing an error status, without a shared.ts change.
 * - pull_requests.status: 'open' | 'closed' | 'merged'
 *   (src/shared/pull-requests.ts:1, src/main/db/schema-pull-requests.ts:35).
 * - pull_requests.reviewDecision: the raw GitHub GraphQL enum, upper-cased —
 *   'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
 *   (src/main/core/pull-requests/pr-upsert.ts:84,107 store `node.reviewDecision`
 *   straight off the GraphQL response with no case normalization).
 * - published_permission_requests.status / published_plan_requests.status:
 *   'pending' | 'resolved' | 'expired' (src/main/db/schema-sync.ts:88-132).
 * - work_items.status: only 'active' (the default) is written anywhere today
 *   (src/main/db/schema-work-items.ts:23, src/main/core/work-items/
 *   work-item-crud.ts:109); 'done' is the design's target value, checked here
 *   as a forward-compatible string comparison for the same reason as above.
 */

export const WORK_ITEM_STATUS_BUCKETS = [
  'needs_input',
  'failed',
  'ready_to_review',
  'working',
  'idle',
  'done',
] as const;

export type WorkItemStatusBucket = (typeof WORK_ITEM_STATUS_BUCKETS)[number];

/**
 * Facts about one worktree needed to derive its bucket. All plain fields —
 * no objects to reach into, so callers can build this from whatever source
 * (SQLite row, in-memory turn stream) without an adapter layer.
 */
export interface WorktreeStatusInput {
  pendingPermissionRequests: number;
  pendingPlanRequests: number;
  /** Real values today: 'active' | 'suspended' | 'done'; see module doc comment. */
  sessionStatuses: readonly string[];
  lastTurnErrored: boolean;
  /** A push or commit failure surfaced for this worktree. */
  gitOperationFailed: boolean;
  isTurnStreaming: boolean;
  hasUnreadFinishedTurn: boolean;
}

/** The agent_session status that marks a session as having failed. */
const SESSION_ERROR_STATUS = 'error';

/** A worktree can never be 'done' — that is a work-item-level fact. */
export type WorktreeBucket = Exclude<WorkItemStatusBucket, 'done'>;

/**
 * Buckets a single worktree in priority order: needs_input beats failed
 * beats working beats ready_to_review beats idle. `working` outranks
 * `ready_to_review` per the design's collapsed-card rule, so a worktree that
 * is still streaming never shows as ready while it is busy.
 */
export function deriveWorktreeStatus(input: WorktreeStatusInput): WorktreeBucket {
  if (input.pendingPermissionRequests > 0 || input.pendingPlanRequests > 0) {
    return 'needs_input';
  }
  if (
    input.lastTurnErrored ||
    input.gitOperationFailed ||
    input.sessionStatuses.some((status) => status === SESSION_ERROR_STATUS)
  ) {
    return 'failed';
  }
  if (input.isTurnStreaming) {
    return 'working';
  }
  if (input.hasUnreadFinishedTurn) {
    return 'ready_to_review';
  }
  return 'idle';
}

/** Real PR status/review-decision values, see module doc comment. */
export interface WorkItemPullRequestContext {
  status: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  reviewDecision: string | null;
  checksPassing: boolean | null;
}

/** Work-item-level facts layered on top of its worktrees' buckets. */
export interface WorkItemStatusContext {
  workItemStatus: string;
  pullRequest: WorkItemPullRequestContext | null;
}

/**
 * Aggregation order, not the Attention sort order: `working` outranks
 * `ready_to_review` here (2 < 3) per the design's collapsed-card rule, so a
 * work item with a busy worktree keeps its spinner instead of flipping to
 * ready. `WORK_ITEM_STATUS_PRIORITY` below is a different, user-facing sort
 * where `ready_to_review` comes before `working` — the two intentionally
 * disagree; do not unify them.
 */
const WORKTREE_BUCKET_PRIORITY: Record<WorktreeBucket, number> = {
  needs_input: 0,
  failed: 1,
  working: 2,
  ready_to_review: 3,
  idle: 4,
};

function pickMostUrgentBucket(buckets: readonly WorktreeBucket[]): WorktreeBucket {
  return buckets.reduce((best, bucket) =>
    WORKTREE_BUCKET_PRIORITY[bucket] < WORKTREE_BUCKET_PRIORITY[best] ? bucket : best
  );
}

/** True when the PR itself counts as ready to review (see design table). */
function isPullRequestReady(pr: WorkItemPullRequestContext): boolean {
  return (
    pr.status === 'open' &&
    !pr.isDraft &&
    pr.checksPassing === true &&
    pr.reviewDecision !== 'CHANGES_REQUESTED'
  );
}

/**
 * Aggregates a work item's bucket from its worktrees (already-derived
 * buckets — the simpler of the two shapes to compose) plus work-item-level
 * facts. `done` wins outright when the work item is marked done or its PR is
 * merged. Otherwise the highest-priority worktree bucket applies, with the
 * PR's own `ready_to_review` counting only when no worktree is more urgent
 * (needs_input, failed, or working).
 *
 * An empty `worktrees` array means a local work item with no worktrees at
 * all, which is a bug — every local item provisions at least a primary
 * worktree — so this throws rather than guessing a bucket.
 */
export function deriveWorkItemStatus(
  worktrees: readonly WorktreeBucket[],
  context: WorkItemStatusContext
): WorkItemStatusBucket {
  if (worktrees.length === 0) {
    throw new Error('deriveWorkItemStatus: a work item must have at least one worktree');
  }

  if (context.workItemStatus === 'done' || context.pullRequest?.status === 'merged') {
    return 'done';
  }

  const worktreeBucket = pickMostUrgentBucket(worktrees);
  if (worktreeBucket !== 'ready_to_review' && worktreeBucket !== 'idle') {
    return worktreeBucket;
  }

  if (context.pullRequest && isPullRequestReady(context.pullRequest)) {
    return 'ready_to_review';
  }

  return worktreeBucket;
}

/** Attention-sort priority: lower sorts first (most urgent first). */
export const WORK_ITEM_STATUS_PRIORITY: Record<WorkItemStatusBucket, number> = {
  needs_input: 0,
  failed: 1,
  ready_to_review: 2,
  working: 3,
  idle: 4,
  done: 5,
};

/** Comparator for sorting work items by urgency, most urgent first. */
export function compareWorkItemStatusBuckets(
  a: WorkItemStatusBucket,
  b: WorkItemStatusBucket
): number {
  return WORK_ITEM_STATUS_PRIORITY[a] - WORK_ITEM_STATUS_PRIORITY[b];
}
