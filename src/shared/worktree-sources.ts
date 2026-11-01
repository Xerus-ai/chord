import type { AgentProviderId } from './agent-provider-registry';
import type { SessionImportError } from './session-import';

/**
 * Checkouts of a registered repository that Chord did not make (plan §Phase 3
 * slice 6), and adopting one as a work item. Where a checkout came from is
 * read from its path: Claude Code puts its worktrees at
 * `<repo>/.claude/worktrees/<name>`; anything else is `other`.
 */
export const WORKTREE_SOURCE_IDS = ['claudeCode', 'other'] as const;
export type WorktreeSourceId = (typeof WORKTREE_SOURCE_IDS)[number];

export const WORKTREE_SOURCE_VISIBILITIES = ['show', 'hide'] as const;
export type WorktreeSourceVisibility = (typeof WORKTREE_SOURCE_VISIBILITIES)[number];

/** `show`: listed under the repository with Adopt. `hide`: counted in "Review N worktrees". */
export type WorktreeSourceSettings = Record<WorktreeSourceId, WorktreeSourceVisibility>;

/** 'chord' when Chord made a lane's checkout, 'adopted' when it is the user's own. */
export type CheckoutOrigin = 'chord' | 'adopted';

export interface DiscoveredWorktree {
  /** Native, resolved path. */
  path: string;
  /** Null for a detached checkout, which Adopt refuses as `no_branch`. */
  branch: string | null;
  head: string | null;
  source: WorktreeSourceId;
}

export interface RepoWorktreeSources {
  repoId: string;
  /** Sources the user shows: listed under the repository with Adopt. */
  listed: DiscoveredWorktree[];
  /** Hidden sources, for the one "Review N worktrees" line; empty after "Hide for this repo". */
  review: DiscoveredWorktree[];
}

/** A repository whose checkouts could not be read, and whether its folder is gone. */
export interface RepoWorktreeSourcesFailure {
  repoId: string;
  message: string;
  /** The registered folder no longer exists: the rail offers to archive the repository. */
  folderMissing: boolean;
}

export type AdoptWorktreeError =
  | { type: 'repo_not_found' }
  | { type: 'invalid_name' }
  | { type: 'not_a_worktree'; path: string }
  | { type: 'no_branch'; path: string }
  /** A lane holds this branch, but its folder was removed outside git. */
  | { type: 'stale_lane'; laneId: string; path: string }
  /** A lane already holds this folder. */
  | { type: 'already_adopted'; laneId: string }
  /** Where the lane's PR would merge could not be read from this clone. */
  | { type: 'target_unknown'; message: string };

export type PointLaneAtFolderError =
  | { type: 'lane_not_found' }
  | { type: 'not_a_worktree'; path: string }
  | { type: 'already_adopted'; laneId: string };

export interface AdoptWorktreeSession {
  providerId: AgentProviderId;
  providerSessionId: string;
}

export interface AdoptedWorktree {
  workItemId: string;
  worktreeId: string;
  imported: { providerSessionId: string; sessionId: string }[];
  importFailures: { providerSessionId: string; error: SessionImportError }[];
}

/** Whether `folder` sits directly under a `.claude/worktrees` folder, on either separator. */
export function classifyWorktreeSource(folder: string): WorktreeSourceId {
  const parts = folder.split(/[\\/]+/).filter((part) => part.length > 0);
  const n = parts.length;
  return n >= 3 && parts[n - 2] === 'worktrees' && parts[n - 3] === '.claude'
    ? 'claudeCode'
    : 'other';
}

/** The default name of an adopted work item: the newest found session's title, else the branch. */
export function pickAdoptionName(
  sessions: { title: string | null; lastActivityAt: number | null }[],
  branch: string
): string {
  const newest = [...sessions].sort(
    (a, b) => (b.lastActivityAt ?? -Infinity) - (a.lastActivityAt ?? -Infinity)
  )[0];
  return newest?.title?.trim() || branch;
}

/** What an Adopt refusal says to the user, in the dialog. */
export function describeAdoptWorktreeError(error: AdoptWorktreeError): string {
  switch (error.type) {
    case 'repo_not_found':
      return 'This repository is no longer registered.';
    case 'invalid_name':
      return 'Give the work item a name.';
    case 'not_a_worktree':
      return 'This folder is no longer one of the repository’s worktrees.';
    case 'no_branch':
      return 'This checkout is not on a branch (detached HEAD). Check out a branch in it first.';
    case 'stale_lane':
      return `A work item's branch holds this branch, but its folder ${error.path} is gone.`;
    case 'already_adopted':
      return 'This folder is already a work item.';
    case 'target_unknown':
      return error.message;
  }
}
