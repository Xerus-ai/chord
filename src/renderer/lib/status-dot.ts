import type { WorkItemStatusBucket } from '@shared/work-item-status';

/**
 * The renderer's ONE status-colour mapping. A sidebar row, a rail section header, an
 * activity-bar icon and a hover card all call this rather than restating
 * which colour a state gets. A second table is how two surfaces start
 * disagreeing about what "pending" looks like.
 *
 * It lives in `lib/` rather than in either feature because both the left
 * sidebar and the right rail need it: a feature importing another feature's
 * directory is the wrong dependency direction.
 *
 * Two layers, deliberately:
 *
 * - `StatusSignal` is the shared vocabulary of *colours a signal can have*.
 *   Domain derivations that produce one — a PR's CI/review state, a git change
 *   kind — stay in the feature that owns that domain.
 * - `statusSignalForBucket` is the one derivation shared enough to live here,
 *   because a work item's bucket comes from `@shared/work-item-status`, which
 *   both features already read.
 *
 * A dot and a label now draw from the SAME band (`--status-*`). The app used
 * to carry a second, louder dot family so a few points of solid colour would
 * not read dimmer than the metadata beside it; that band was tuned against a
 * near-black ground, and the signal set was re-tuned when the ground moved to
 * #29282b (the color token system design). One band
 * is one answer to "what colour is failing".
 */
export type StatusSignal = 'success' | 'danger' | 'warning' | 'running' | 'merged' | 'neutral';

const DOT_CLASS: Record<StatusSignal, string> = {
  success: 'bg-status-ok',
  danger: 'bg-status-err',
  warning: 'bg-status-warn',
  running: 'bg-status-running',
  merged: 'bg-status-merged',
  neutral: 'bg-status-idle',
};

const TEXT_CLASS: Record<StatusSignal, string> = {
  success: 'text-status-ok',
  danger: 'text-status-err',
  warning: 'text-status-warn',
  running: 'text-status-running',
  merged: 'text-status-merged',
  neutral: 'text-text-passive',
};

export function statusDotClass(signal: StatusSignal): string {
  return DOT_CLASS[signal];
}

export function statusTextClass(signal: StatusSignal): string {
  return TEXT_CLASS[signal];
}

/** Only a running signal animates; a pulsing idle dot would be noise. */
export function isStatusSignalPulsing(signal: StatusSignal): boolean {
  return signal === 'running';
}

/** A work item's or worktree's bucket as a colour. */
const BUCKET_SIGNAL: Record<WorkItemStatusBucket, StatusSignal> = {
  needs_input: 'warning',
  failed: 'danger',
  ready_to_review: 'success',
  working: 'running',
  idle: 'neutral',
  done: 'merged',
};

export function statusSignalForBucket(bucket: WorkItemStatusBucket): StatusSignal {
  return BUCKET_SIGNAL[bucket];
}

export function getStatusDotColor(bucket: WorkItemStatusBucket): string {
  return statusDotClass(statusSignalForBucket(bucket));
}

export function isStatusDotPulsing(bucket: WorkItemStatusBucket): boolean {
  return isStatusSignalPulsing(statusSignalForBucket(bucket));
}

/**
 * The bucket's word for a meta line. Present tense, lower case, no punctuation:
 * it sits between the repo and the time as one more fact, not as a label.
 */
const STATUS_WORD: Record<WorkItemStatusBucket, string> = {
  needs_input: 'waiting for you',
  failed: 'failed',
  ready_to_review: 'ready',
  working: 'working',
  idle: 'idle',
  done: 'done',
};

export function getStatusWord(bucket: WorkItemStatusBucket): string {
  return STATUS_WORD[bucket];
}
