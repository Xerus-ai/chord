import type { BranchHolder, BranchPick, PullRequestPick } from '@shared/create-from';
import type { Issue } from '@shared/tasks';
import type { WorkItemTicket } from '@shared/work-item-ticket';
import {
  resolveCreateTarget,
  type CreateTarget,
  type PullRequestLookupState,
} from './create-target';
import { resolveSmartField, type SmartFieldResolution } from './smart-resolve';

/**
 * What a pick in Create from… creates (plan §Phase 3 slice 2). An issue and a
 * PR go through slice 1's `resolveCreateTarget` — the same target their pasted
 * URL makes once looked up — so nothing here forks that logic. A branch is a
 * checkout of itself; one checked out elsewhere is never reused, and "Branch
 * off <branch> instead" (`branch_off`) is the only way on. The picker and a
 * pasted PR URL are the only senders of `existingBranch`.
 */
export type CreateFromPick =
  | { kind: 'issue'; issue: Issue }
  | { kind: 'pull_request'; pullRequest: PullRequestPick }
  | { kind: 'branch'; branch: BranchPick }
  | { kind: 'branch_off'; branch: string };

function toIssueResolution(issue: Issue): SmartFieldResolution {
  if (issue.provider !== 'github') {
    return { kind: issue.provider, issueKey: issue.identifier, url: issue.url };
  }
  const resolution = resolveSmartField(issue.url);
  if (resolution?.kind !== 'github' || resolution.type !== 'issue') {
    throw new Error(`GitHub issue ${issue.identifier} has no issue URL: ${issue.url}`);
  }
  return resolution;
}

/** The ticket an issue pick links: what `getIssue` answers for its pasted URL. */
function toIssueTicket(issue: Issue): WorkItemTicket {
  return {
    provider: issue.provider,
    id: issue.provider === 'github' ? issue.identifier.replace(/^#/, '') : issue.identifier,
    url: issue.url,
    title: issue.title,
  };
}

function describeHeld(branch: string, holder: BranchHolder): string {
  const where =
    holder.kind === 'checkout'
      ? `in ${holder.path}`
      : `in work item ${holder.workItemName} (${holder.path})`;
  return `${branch} is already checked out ${where}. A lane needs a branch of its own.`;
}

function findHolder(branch: string, branches: readonly BranchPick[]): BranchHolder | null {
  return branches.find((pick) => pick.localBranch === branch && pick.holder)?.holder ?? null;
}

/** Where a listed branch is checked out, as its row says it. */
export function describeBranchHolder(holder: BranchHolder): string {
  return holder.kind === 'checkout'
    ? `checked out in ${holder.path}`
    : `in work item ${holder.workItemName}`;
}

/**
 * A checkout of a branch the listing shows as checked out elsewhere becomes
 * the refusal — for a pasted PR URL as for a pick.
 */
export function applyBranchHolders(
  target: CreateTarget | null,
  branches: readonly BranchPick[]
): CreateTarget | null {
  if (target?.kind !== 'checkout') return target;
  const holder = findHolder(target.branch, branches);
  if (!holder) return target;
  return {
    kind: 'held',
    branch: target.branch,
    holder,
    message: describeHeld(target.branch, holder),
  };
}

function resolveBranchTarget(pick: BranchPick, branches: readonly BranchPick[]): CreateTarget {
  const branch = pick.localBranch;
  // The latest listing decides: a branch taken since it was picked is held.
  const holder = pick.holder ?? findHolder(branch, branches);
  if (holder) return { kind: 'held', branch, holder, message: describeHeld(branch, holder) };
  return {
    kind: 'checkout',
    name: pick.name,
    branch,
    label: pick.remote ? `Checks out ${branch} from ${pick.remote}` : `Checks out ${branch}`,
    notice: null,
    pullRequest: null,
    ...(pick.tracking ? { tracking: pick.tracking } : {}),
  };
}

export function resolvePickTarget(input: {
  pick: CreateFromPick;
  pullRequestLookup: PullRequestLookupState | null;
  branches: readonly BranchPick[];
}): CreateTarget {
  const { pick, branches } = input;
  switch (pick.kind) {
    case 'issue': {
      const target = resolveCreateTarget({
        resolution: toIssueResolution(pick.issue),
        issueLookup: { status: 'found', ticket: toIssueTicket(pick.issue) },
        pullRequestLookup: null,
      });
      if (!target) throw new Error(`Issue ${pick.issue.identifier} resolved to nothing`);
      return target;
    }
    case 'pull_request': {
      const { owner, repo, number, url } = pick.pullRequest;
      const target = resolveCreateTarget({
        resolution: { kind: 'github', owner, repo, number, type: 'pull', url },
        issueLookup: null,
        pullRequestLookup: input.pullRequestLookup,
      });
      const applied = applyBranchHolders(target, branches);
      if (!applied) throw new Error(`PR #${number} resolved to nothing`);
      return applied;
    }
    case 'branch':
      return resolveBranchTarget(pick.branch, branches);
    case 'branch_off':
      return {
        kind: 'branch_off',
        name: pick.branch,
        baseRef: pick.branch,
        label: `New branch from ${pick.branch}`,
      };
  }
}

type CreateFailure = {
  readonly type: string;
  readonly message?: string;
  readonly branch?: string;
  readonly path?: string;
  readonly gitOutput?: string;
};

/**
 * A refused create, inline in the dialog. A branch checked out elsewhere
 * (taken since it was picked, or a pasted PR's) offers to branch off it. What
 * git said, when the remote could not be asked, is kept apart for the dialog
 * to fold away (devstation-kcvy).
 */
export function describeCreateFailure(error: CreateFailure): {
  message: string;
  gitOutput: string | null;
  branchOff: string | null;
} {
  return {
    message: `Create work item failed: ${error.message ?? error.type}`,
    gitOutput: error.gitOutput ?? null,
    branchOff: error.type === 'branch_checked_out' && error.branch ? error.branch : null,
  };
}
