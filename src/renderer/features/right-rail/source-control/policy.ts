import type { BranchPublicationKind } from '@shared/git';

/**
 * Which action the Source Control split button offers, as a pure function of
 * the worktree's state, with a menu whose shape stays stable.
 *
 * Two rules the UI must not restate:
 *  - The menu always lists every action. An action that cannot run right now
 *    is disabled with a reason, never hidden — a menu that changes shape is a
 *    menu the user has to re-read.
 *  - Reasons are codes, not prose. Wording belongs to the component that
 *    renders it; this file must stay testable without a translation table.
 */
export type SourceControlActionKind =
  | 'resolve-conflicts'
  | 'commit'
  | 'publish'
  | 'push'
  | 'create-pr'
  | 'pull';

export type SourceControlReason =
  | 'no-checkout'
  | 'conflicts-present'
  | 'nothing-to-commit'
  | 'no-commit-message'
  | 'no-branch'
  | 'already-published'
  | 'not-published'
  | 'no-remote'
  | 'publication-loading'
  | 'nothing-to-push'
  | 'lanes-loading'
  | 'pr-exists'
  | 'no-github-remote'
  | 'busy';

export interface SourceControlAction {
  kind: SourceControlActionKind;
  /** null means the action can run now. */
  disabledReason: SourceControlReason | null;
}

export interface SourceControlPolicyInput {
  /** False while the worktree's workspace is not acquired — everything is off. */
  hasCheckout: boolean;
  stagedCount: number;
  unstagedCount: number;
  conflictCount: number;
  /** Commits on this branch that the remote does not have. */
  aheadCount: number;
  /**
   * Whether the branch is on the remote Push sends it to, read by git
   * (`BranchPublication`); null until that read lands, so nothing guesses.
   */
  publication: BranchPublicationKind | null;
  branchName: string | null;
  /** The focused lane already has a pull request (PRs are per lane, not per work item). */
  hasPullRequest: boolean;
  /**
   * The checkout has a GitHub remote to open a PR in. Needed on its own: a
   * published branch on a non-GitHub remote can't open one (devstation-vzg).
   */
  hasGitHubRemote: boolean;
  /**
   * The work item's lanes and their PRs have been read. Until then neither
   * `hasPullRequest` nor `hasGitHubRemote` is known, and Create PR says it is
   * waiting rather than stating a reason that may be false.
   */
  lanesLoaded: boolean;
  commitMessage: string;
  /** A git action is already running; every action waits rather than queueing. */
  busy: boolean;
}

const ORDER: readonly SourceControlActionKind[] = [
  'resolve-conflicts',
  'commit',
  'publish',
  'push',
  'create-pr',
  'pull',
];

/**
 * Why a branch can't publish, push or pull yet, before the action's own rule.
 * Publish is the way out of `unpublished`, so only push and pull stop there.
 */
function publicationReason(
  input: SourceControlPolicyInput,
  kind: 'publish' | 'push' | 'pull'
): SourceControlReason | null {
  if (input.publication === null) return 'publication-loading';
  if (input.publication === 'no_remote') return 'no-remote';
  if (input.publication === 'detached' || !input.branchName) return 'no-branch';
  if (input.publication === 'unpublished' && kind !== 'publish') return 'not-published';
  return null;
}

function reasonFor(
  kind: SourceControlActionKind,
  input: SourceControlPolicyInput
): SourceControlReason | null {
  if (!input.hasCheckout) return 'no-checkout';
  if (input.busy) return 'busy';

  switch (kind) {
    case 'resolve-conflicts':
      return input.conflictCount > 0 ? null : 'nothing-to-commit';
    case 'commit':
      // Conflicts first: committing a conflicted tree records the markers.
      if (input.conflictCount > 0) return 'conflicts-present';
      if (input.stagedCount + input.unstagedCount === 0) return 'nothing-to-commit';
      if (!input.commitMessage.trim()) return 'no-commit-message';
      return null;
    case 'publish':
      return (
        publicationReason(input, 'publish') ??
        (input.publication === 'published' ? 'already-published' : null)
      );
    case 'push':
      return publicationReason(input, 'push') ?? (input.aheadCount > 0 ? null : 'nothing-to-push');
    case 'create-pr':
      if (!input.lanesLoaded) return 'lanes-loading';
      if (input.hasPullRequest) return 'pr-exists';
      if (!input.hasGitHubRemote) return 'no-github-remote';
      // Waits for the read so the band's primary doesn't flip to Publish once
      // it lands. An unpublished branch is fine: Create PR publishes it first
      // (create-lane-pull-request.ts).
      if (input.publication === null) return 'publication-loading';
      if (input.publication === 'detached' || !input.branchName) return 'no-branch';
      return null;
    case 'pull':
      return publicationReason(input, 'pull');
  }
}

/**
 * The primary action is the first enabled one in priority order: fix the
 * conflict, then record the work, then publish it, then push it, then open the
 * PR, then take what the remote has. When nothing can run the primary is
 * `commit` — the action the panel is about — carrying its own reason.
 */
export function selectSourceControlActions(input: SourceControlPolicyInput): {
  primary: SourceControlAction;
  actions: SourceControlAction[];
} {
  const actions = ORDER.map((kind) => ({ kind, disabledReason: reasonFor(kind, input) }));
  const primary = actions.find((action) => action.disabledReason === null);
  return {
    primary: primary ?? actions.find((action) => action.kind === 'commit')!,
    actions,
  };
}
