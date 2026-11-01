import type { BranchHolder, RemoteBranchRef } from '@shared/create-from';
import type { CreateWorkItemArgs } from '@shared/create-work-item';
import type {
  IssueLookupError,
  IssueRef,
  PullRequestCheckout,
  PullRequestCheckoutSource,
  TicketProvider,
  WorkItemTicket,
} from '@shared/work-item-ticket';
import {
  provisionalName,
  toIssueRef,
  toPullRequestRef,
  type SmartFieldResolution,
} from './smart-resolve';

/**
 * What the create dialog shows before Create, and the one request it sends.
 * The dialog renders `resolveCreateTarget` and sends `buildCreateWorkItemArgs`
 * of the same target, so what is shown is exactly what is created.
 */

export type IssueLookupState =
  | { status: 'looking_up' }
  | { status: 'found'; ticket: WorkItemTicket }
  | { status: 'failed'; error: IssueLookupError };

/** A PR lookup fails with its head's or its checkout plan's typed error. */
export type PullRequestLookupState =
  | { status: 'looking_up' }
  | { status: 'found'; checkout: PullRequestCheckout }
  | { status: 'failed'; error: { type: string; message: string } };

export type CreateTarget =
  /** A lookup is pending: nothing can be created yet. */
  | { kind: 'looking_up'; label: string }
  | { kind: 'new_lane'; name: string; ticket: WorkItemTicket | null; notice: string | null }
  | {
      kind: 'checkout';
      name: string;
      branch: string;
      label: string;
      notice: string | null;
      /** Set for a fork PR, whose branch is fetched from origin's pull ref. */
      pullRequest: PullRequestCheckoutSource | null;
      /** Set for a branch picked from a remote: `branch` is created tracking it. */
      tracking?: RemoteBranchRef;
    }
  /** A PR whose head couldn't be resolved: nothing to check out. */
  | { kind: 'unavailable'; message: string }
  /** A branch checked out elsewhere: never reused; "Branch off" is the way on. */
  | { kind: 'held'; branch: string; holder: BranchHolder; message: string }
  /** A new lane whose fork point is a picked branch (`baseRef`). */
  | { kind: 'branch_off'; name: string; baseRef: string; label: string };

const PROVIDER_LABELS: Record<TicketProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
};

function ticketId(ref: IssueRef): string {
  return ref.provider === 'github' ? String(ref.number) : ref.key;
}

function ticketUrl(resolution: SmartFieldResolution): string | null {
  return resolution.kind === 'name' ? null : resolution.url;
}

function describeLookupFailure(key: string, provider: string, error: IssueLookupError): string {
  switch (error.type) {
    case 'not_connected':
      return `${provider} isn't connected, so this is named ${key} only. Connect ${provider} in Settings › Integrations to name it from its title.`;
    case 'not_found':
      return `${key} was not found in ${provider}, so this is named ${key} only.`;
    case 'error':
      return `Couldn't read ${key} from ${provider} (${error.message}), so this is named ${key} only.`;
  }
}

function resolveTicketTarget(
  resolution: SmartFieldResolution,
  ref: IssueRef,
  lookup: IssueLookupState | null
): CreateTarget {
  const key = provisionalName(resolution);
  if (!lookup || lookup.status === 'looking_up') {
    return { kind: 'looking_up', label: `Looking up ${key}…` };
  }
  if (lookup.status === 'found') {
    const { title } = lookup.ticket;
    return {
      kind: 'new_lane',
      name: title ? `${key} ${title}` : key,
      ticket: lookup.ticket,
      notice: null,
    };
  }
  return {
    kind: 'new_lane',
    name: key,
    ticket: { provider: ref.provider, id: ticketId(ref), url: ticketUrl(resolution), title: null },
    notice: describeLookupFailure(key, PROVIDER_LABELS[ref.provider], lookup.error),
  };
}

function resolveCheckoutTarget(checkout: PullRequestCheckout): CreateTarget {
  const pr = `PR #${checkout.number}`;
  const name = `#${checkout.number} ${checkout.title}`;
  if (!checkout.crossRepository) {
    // On a remote other than the preferred one: made tracking it, as a picked remote branch.
    const { tracking } = checkout;
    return {
      kind: 'checkout',
      name,
      branch: checkout.branch,
      label: tracking
        ? `Checks out ${checkout.branch} from ${tracking.remote} (${pr})`
        : `Checks out ${checkout.branch} (${pr})`,
      notice: null,
      pullRequest: null,
      ...(tracking ? { tracking } : {}),
    };
  }
  const from = checkout.headRepo ?? `${checkout.headOwner}'s deleted fork`;
  const notice = !checkout.headRepo
    ? `The fork this PR came from was deleted: the branch checks out from the PR, but commits can't be pushed back to it.`
    : checkout.maintainerCanModify
      ? null
      : `${checkout.headRepo} doesn't accept maintainer pushes: the branch checks out, but commits can't be pushed to the PR.`;
  return {
    kind: 'checkout',
    name,
    branch: checkout.branch,
    label: `Checks out ${checkout.branch} from ${from} (${pr})`,
    notice,
    pullRequest: {
      number: checkout.number,
      headRef: checkout.headRef,
      headOwner: checkout.headOwner,
      headCloneUrl: checkout.headCloneUrl,
      maintainerCanModify: checkout.maintainerCanModify,
      baseRemote: checkout.baseRemote,
    },
  };
}

export function resolveCreateTarget(input: {
  resolution: SmartFieldResolution | null;
  issueLookup: IssueLookupState | null;
  pullRequestLookup: PullRequestLookupState | null;
}): CreateTarget | null {
  const { resolution } = input;
  if (!resolution) return null;

  const pull = toPullRequestRef(resolution);
  if (pull) {
    const lookup = input.pullRequestLookup;
    if (!lookup || lookup.status === 'looking_up') {
      return { kind: 'looking_up', label: `Looking up PR #${pull.number}…` };
    }
    if (lookup.status === 'found') return resolveCheckoutTarget(lookup.checkout);
    return {
      kind: 'unavailable',
      message:
        lookup.error.type === 'not_connected'
          ? `GitHub isn't connected: connect it in Settings › Integrations to check out PR #${pull.number}.`
          : `Can't check out PR #${pull.number}: ${lookup.error.message}`,
    };
  }

  const ref = toIssueRef(resolution);
  if (ref) return resolveTicketTarget(resolution, ref, input.issueLookup);
  return {
    kind: 'new_lane',
    name: resolution.kind === 'name' ? resolution.name : provisionalName(resolution),
    ticket: null,
    notice: null,
  };
}

/** The one request for a target, or null when there is nothing to create yet. */
export function buildCreateWorkItemArgs(
  target: CreateTarget,
  options: { id: string; repoId?: string; agentProvider?: string; baseRef?: string }
): CreateWorkItemArgs | null {
  const common = {
    id: options.id,
    repoId: options.repoId,
    agentProvider: options.agentProvider,
  };
  switch (target.kind) {
    case 'looking_up':
    case 'unavailable':
    case 'held':
      return null;
    case 'branch_off':
      // The picked branch is the fork point: Advanced's base doesn't override it.
      return { ...common, name: target.name, baseRef: target.baseRef };
    case 'new_lane': {
      const baseRef = options.baseRef?.trim();
      return {
        ...common,
        name: target.name,
        ...(baseRef ? { baseRef } : {}),
        ...(target.ticket ? { ticket: target.ticket } : {}),
      };
    }
    case 'checkout':
      // A checkout has no fork point: Advanced's base branch doesn't apply.
      return {
        ...common,
        name: target.name,
        existingBranch: target.branch,
        ...(target.pullRequest ? { pullRequest: target.pullRequest } : {}),
        ...(target.tracking ? { trackRemoteBranch: target.tracking } : {}),
      };
  }
}

/** A pasted ticket link (the dashboard composer's ticket field), with no title read. */
export function toTicketLink(resolution: SmartFieldResolution): WorkItemTicket | null {
  const ref = toIssueRef(resolution);
  if (!ref) return null;
  return { provider: ref.provider, id: ticketId(ref), url: ticketUrl(resolution), title: null };
}
