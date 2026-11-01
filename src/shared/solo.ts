import type { StartLaneRunError } from './lane-runs';

/**
 * A repository's Solo slot as the Run tab and the sidebar see it (plan
 * 2026-09-26 §"Decisions for Phase 4", Solo host and Slot + queue): the lane
 * holding the root checkout, the lanes queued for it, and a hold a previous
 * run of the app left on a root that changed since. Runtime state of the main
 * process; the queue does not survive a restart.
 */

export interface SoloLaneRef {
  laneId: string;
  workItemId: string;
  workItemName: string;
  /** Null for a lane on a detached HEAD. */
  branch: string | null;
}

export interface SoloView {
  repoId: string;
  /** The repository's root checkout, where Solo runs. */
  rootPath: string;
  /** `since` is when the root took the lane's state (ISO 8601). */
  holder: (SoloLaneRef & { since: string }) | null;
  /** First in line first. */
  queue: SoloLaneRef[];
  /**
   * A hold left by a previous run on a root changed since (`files`): kept
   * for the user to restore. `branch` is null once the lane is gone.
   */
  interrupted: { laneId: string; branch: string | null; files: string[] } | null;
}

export type SoloRootOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

/** Why a lane did not take the slot or join its queue; the root is untouched on every one. */
export type SoloLaneError =
  | { type: 'not_found' }
  | { type: 'no_repo' }
  | { type: 'not_solo_mode' }
  | { type: 'config_invalid'; message: string }
  | { type: 'no_script' }
  | { type: 'declined' }
  | { type: 'setup_running' }
  | { type: 'checkout_missing' }
  | { type: 'solo_interrupted' }
  /** The root holds a lane this run of the app did not put there. */
  | { type: 'solo_held'; laneId: string }
  | { type: 'root_busy'; operation: SoloRootOperation }
  | { type: 'root_dirty'; files: string[] };

/** One run script's start in the root; `error` is why it did not start. */
export interface SoloRunStart {
  scriptId: string;
  error: StartLaneRunError | null;
}

export type SoloLaneOutcome =
  | { status: 'holding'; starts: SoloRunStart[] }
  /** 1 is next in line. */
  | { status: 'queued'; position: number };

/** Run output a lane's rules ignored and the root's do not, moved out of the root on release. */
export interface SoloLeftovers {
  /** `<root git dir>/chord-solo-leftovers/<timestamp>`; files keep their relative paths. */
  dir: string;
  files: string[];
}

export interface SoloReleaseOutcome {
  releasedLaneId: string;
  leftovers: SoloLeftovers | null;
  /** The queued lane that took the slot, with its run scripts' starts. */
  handedTo: { laneId: string; starts: SoloRunStart[] } | null;
  /** Queued lanes that could not take the slot, in turn, and why. */
  skipped: { laneId: string; reason: string }[];
}

export type SoloReleaseTarget = { repoId: string } | { laneId: string };

export type SoloHoldError = { type: 'solo_not_held' } | { type: 'root_changed'; files: string[] };

/** Every refusal the Run tab's Solo controls can show. */
export type SoloActionError = SoloLaneError | SoloHoldError | { type: 'not_queued' };
