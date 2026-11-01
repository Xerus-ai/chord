import type { BranchPublicationKind } from '@shared/git';
import type { StatusSignal } from '@renderer/lib/status-dot';

/**
 * The one line that says where the work item is.
 *
 * Priority is "what would stop you shipping", top down: a conflict, then a red
 * check, then a review that wants changes, then the plain progress of the work
 * — uncommitted, unpushed, unopened. A merged PR ends the ladder. The band is
 * the permanent copy of this state, which is why it is derived rather than
 * echoed from whichever panel happens to be open.
 */
export type BandStateGlyph =
  | 'conflict'
  | 'check-failed'
  | 'check-running'
  | 'changes-requested'
  | 'merged'
  | 'ready'
  | 'changes'
  | 'ahead'
  | 'branch';

export interface BandState {
  glyph: BandStateGlyph;
  signal: StatusSignal;
  text: string;
  /**
   * What the band shows when the rail is too narrow for `text` — the count
   * alone beside its glyph, or a one-word state. `text` stays the tooltip.
   */
  short: string;
}

export interface BandStateInput {
  conflictCount: number;
  changedCount: number;
  aheadCount: number;
  /**
   * Where the branch stands against the remote Push sends it to, read by git;
   * null until that read lands. Never inferred from the commit list: a lane
   * forked from origin/main shares main's pushed commits (devstation-dh2).
   */
  publication: BranchPublicationKind | null;
  prState: 'open' | 'merged' | 'closed' | 'draft' | null;
  failingCheckCount: number;
  runningCheckCount: number;
  reviewState: 'approved' | 'changes_requested' | 'pending' | null;
  canMerge: boolean;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function deriveBandState(input: BandStateInput): BandState {
  if (input.conflictCount > 0) {
    return {
      glyph: 'conflict',
      signal: 'danger',
      text: `${plural(input.conflictCount, 'file')} conflicted`,
      short: `${input.conflictCount}`,
    };
  }
  if (input.prState === 'merged') {
    return { glyph: 'merged', signal: 'merged', text: 'Merged', short: 'Merged' };
  }
  if (input.failingCheckCount > 0) {
    return {
      glyph: 'check-failed',
      signal: 'danger',
      text: `${plural(input.failingCheckCount, 'check')} failing`,
      short: `${input.failingCheckCount}`,
    };
  }
  if (input.reviewState === 'changes_requested') {
    return {
      glyph: 'changes-requested',
      signal: 'warning',
      text: 'Changes requested',
      short: 'Changes',
    };
  }
  if (input.runningCheckCount > 0) {
    return {
      glyph: 'check-running',
      signal: 'running',
      text: `${plural(input.runningCheckCount, 'check')} running`,
      short: `${input.runningCheckCount}`,
    };
  }
  if (input.canMerge) {
    return { glyph: 'ready', signal: 'success', text: 'Ready to merge', short: 'Ready' };
  }
  if (input.changedCount > 0) {
    return {
      glyph: 'changes',
      signal: 'neutral',
      text: `${plural(input.changedCount, 'uncommitted file')}`,
      short: `${input.changedCount}`,
    };
  }
  if (input.publication === null) {
    return { glyph: 'branch', signal: 'neutral', text: 'Checking the branch…', short: 'Checking' };
  }
  // Before commits to push: with nowhere to push them, that count is a promise
  // the band can't keep (devstation-7eq).
  if (input.publication === 'no_remote') {
    return { glyph: 'branch', signal: 'neutral', text: 'No remote', short: 'No remote' };
  }
  if (input.publication === 'detached') {
    return { glyph: 'branch', signal: 'neutral', text: 'Detached HEAD', short: 'Detached' };
  }
  if (input.aheadCount > 0) {
    return {
      glyph: 'ahead',
      signal: 'neutral',
      text: `${plural(input.aheadCount, 'commit')} to push`,
      short: `${input.aheadCount}`,
    };
  }
  if (input.publication === 'unpublished') {
    return { glyph: 'branch', signal: 'neutral', text: 'Not published', short: 'Unpublished' };
  }
  if (!input.prState) {
    return { glyph: 'branch', signal: 'neutral', text: 'Pushed · no pull request', short: 'No PR' };
  }
  if (input.prState === 'closed') {
    return { glyph: 'branch', signal: 'danger', text: 'Closed', short: 'Closed' };
  }
  if (input.prState === 'draft') {
    return { glyph: 'branch', signal: 'warning', text: 'Draft', short: 'Draft' };
  }
  return { glyph: 'ready', signal: 'neutral', text: 'In review', short: 'In review' };
}
