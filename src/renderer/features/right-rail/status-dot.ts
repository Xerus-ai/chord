import type { StatusSignal } from '@renderer/lib/status-dot';

/**
 * The rail's two domain derivations: a pull request's CI/review signal, and a
 * git change kind. Both produce a `StatusSignal` from
 * `@renderer/lib/status-dot`, which owns the colour tables — the rail knows
 * what a state means, not what colour it is.
 */

export interface ChecksSignalInput {
  /** CI checks for the PR, already normalised to pass/fail/pending. */
  checks: readonly { status: 'pass' | 'fail' | 'pending' }[];
  reviewState: 'approved' | 'changes_requested' | 'pending' | null;
  prState: 'open' | 'merged' | 'closed' | 'draft' | null;
}

/**
 * The dot on the Checks & PR icon. Failure outranks everything — a red dot
 * means "something needs you" and must not be hidden by a pending check that
 * arrived after it. A merged PR is its own signal, not a success.
 */
export function deriveChecksSignal(input: ChecksSignalInput): StatusSignal {
  if (input.prState === 'merged') return 'merged';
  if (input.checks.some((check) => check.status === 'fail')) return 'danger';
  if (input.reviewState === 'changes_requested') return 'danger';
  if (input.checks.some((check) => check.status === 'pending')) return 'running';
  if (input.prState === 'draft') return 'warning';
  if (input.checks.length > 0 && input.checks.every((check) => check.status === 'pass')) {
    return 'success';
  }
  if (input.reviewState === 'approved') return 'success';
  return 'neutral';
}

/** Git change status to a signal, for Explorer decorations and entry rows. */
export function gitChangeSignal(status: string): StatusSignal {
  switch (status) {
    case 'added':
      return 'success';
    case 'deleted':
    case 'conflicted':
      return 'danger';
    case 'renamed':
    case 'modified':
      return 'warning';
    default:
      return 'neutral';
  }
}
