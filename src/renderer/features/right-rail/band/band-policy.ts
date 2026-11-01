import type { ArtifactStatus } from '@main/core/artifacts/artifact-utils';
import {
  selectSourceControlActions,
  type SourceControlActionKind,
  type SourceControlPolicyInput,
  type SourceControlReason,
} from '../source-control/policy';

/**
 * The band's single button, as a pure function of where the work item is.
 *
 * `source-control/policy.ts` already answers "what does this worktree need
 * next" for commit, publish, push and create-PR. This wraps it and adds the
 * three steps it cannot see — merging the pull request, marking the work item
 * done, and approving a focused artifact — so the whole ladder is decided in
 * one place: Commit → Publish → Push → Create PR → Merge → Mark done, with
 * Approve taking the slot while an artifact tab has focus.
 *
 * The two rules inherited from the source-control policy hold here too: the
 * menu lists every action in every state, disabled with a reason rather than
 * hidden, and reasons are codes — wording belongs to the component.
 */
export type BandActionKind =
  | SourceControlActionKind
  | 'merge'
  | 'mark-done'
  | 'approve'
  | 'ask-agent-to-build';

export type BandReason =
  | SourceControlReason
  | 'not-mergeable'
  | 'pr-not-merged'
  | 'already-done'
  | 'no-artifact'
  | 'already-approved'
  | 'participant';

export interface BandAction {
  kind: BandActionKind;
  /** null means the action can run now. */
  disabledReason: BandReason | null;
}

export interface BandPolicyInput {
  sourceControl: SourceControlPolicyInput;
  /** GitHub would accept a merge right now (`useLanePrActions.canMerge`, the focused lane's PR). */
  canMerge: boolean;
  prState: 'open' | 'merged' | 'closed' | 'draft' | null;
  workItemDone: boolean;
  /** The status of the artifact focused in the centre, or null for no artifact tab. */
  focusedArtifactStatus: ArtifactStatus | null;
}

/**
 * Ladder order. `pull` sits after `create-pr` as the source-control policy has
 * it, but the band never leads with it: taking what the remote has is
 * maintenance, not the work item's next step, so it is reachable from the menu
 * and never becomes the button.
 */
const LADDER: readonly BandActionKind[] = [
  'resolve-conflicts',
  'commit',
  'publish',
  'push',
  'create-pr',
  'pull',
  'merge',
  'mark-done',
  'approve',
  'ask-agent-to-build',
];

const NEVER_PRIMARY: readonly BandActionKind[] = ['pull'];

function mergeReason(input: BandPolicyInput): BandReason | null {
  if (input.sourceControl.busy) return 'busy';
  return input.canMerge ? null : 'not-mergeable';
}

function markDoneReason(input: BandPolicyInput): BandReason | null {
  if (input.sourceControl.busy) return 'busy';
  if (input.workItemDone) return 'already-done';
  return input.prState === 'merged' ? null : 'pr-not-merged';
}

function approveReason(input: BandPolicyInput): BandReason | null {
  if (input.sourceControl.busy) return 'busy';
  if (!input.focusedArtifactStatus) return 'no-artifact';
  return input.focusedArtifactStatus === 'approved' ? 'already-approved' : null;
}

function buildReason(input: BandPolicyInput): BandReason | null {
  if (input.sourceControl.busy) return 'busy';
  return input.focusedArtifactStatus ? null : 'no-artifact';
}

/**
 * The button and what sits under its caret.
 *
 * A focused artifact takes the slot outright — the user is looking at the
 * document, so the next thing they can do is about the document. Otherwise the
 * first runnable rung of the ladder wins. When nothing can run there is no
 * button: an always-present button that always refuses is worse than a band
 * that simply states where the work item is.
 */
export function selectBandAction(input: BandPolicyInput): {
  primary: BandAction | null;
  menu: BandAction[];
} {
  const sourceControl = selectSourceControlActions(input.sourceControl);
  const reasonByKind = new Map<BandActionKind, BandReason | null>(
    sourceControl.actions.map((action) => [action.kind, action.disabledReason])
  );
  // The band's Commit opens the message popover, and the message is written
  // there. "No message yet" therefore cannot be what stops the button from
  // appearing — the popover's own commit button is what the message gates.
  if (reasonByKind.get('commit') === 'no-commit-message') reasonByKind.set('commit', null);
  reasonByKind.set('merge', mergeReason(input));
  reasonByKind.set('mark-done', markDoneReason(input));
  reasonByKind.set('approve', approveReason(input));
  reasonByKind.set('ask-agent-to-build', buildReason(input));

  const actions: BandAction[] = LADDER.map((kind) => ({
    kind,
    disabledReason: reasonByKind.get(kind) ?? null,
  }));

  const runnable = (kind: BandActionKind) =>
    actions.find((action) => action.kind === kind && action.disabledReason === null) ?? null;

  const primary = input.focusedArtifactStatus
    ? (runnable('approve') ?? runnable('ask-agent-to-build'))
    : (actions.find(
        (action) => action.disabledReason === null && !NEVER_PRIMARY.includes(action.kind)
      ) ?? null);

  return {
    primary,
    menu: actions.filter((action) => action.kind !== primary?.kind),
  };
}
