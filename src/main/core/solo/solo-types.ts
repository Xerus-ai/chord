/**
 * The hold a lane has on a repo's root checkout, persisted as
 * `<root git dir>/chord-solo.json` once the root holds the lane's state.
 * `backups` are root-relative paths (forward slashes) of the files whose
 * original bytes sit under `<root git dir>/chord-solo-backup/`.
 */
export interface SoloRecord {
  version: 1;
  laneId: string;
  laneCheckoutPath: string;
  rootHead: string;
  /** The branch the root had checked out; null when the root was detached. */
  rootBranch: string | null;
  laneHead: string;
  snapshotCommit: string;
  backups: string[];
  startedAt: string;
}

export type SoloState = { status: 'none' } | { status: 'held'; record: SoloRecord };

export type RootOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

export type AcquireSoloError =
  | { type: 'solo_held'; laneId: string }
  | { type: 'root_busy'; operation: RootOperation }
  | { type: 'root_dirty'; files: string[] };

export type SyncSoloError = { type: 'solo_not_held' } | { type: 'root_changed'; files: string[] };

export type ReleaseSoloError = SyncSoloError;

export type SoloBootRecovery = 'none' | 'released' | { interrupted: { files: string[] } };
