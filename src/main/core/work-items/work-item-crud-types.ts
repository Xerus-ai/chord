import type { SoloRemovalRefusal } from '@main/core/solo/solo-lane-removal';
import type { LaneRemovalRefusal } from './work-item-worktree-git';

/** The argument and error shapes of `work-item-crud.ts`'s update, retry and delete. */

export interface UpdateWorkItemArgs {
  id: string;
  name?: string;
  status?: string;
  agentProvider?: string;
  effort?: string;
  model?: string | null;
  branchName?: string;
  prNumber?: number | null;
  prUrl?: string | null;
}

export interface RetryProvisionOptions {
  /** Fork from the base's last-fetched copy if fetching it fails again (the user chose it). */
  allowLocalCopy?: boolean;
}

export type RetryProvisionError = { type: 'not_found' } | { type: 'not_failed'; status: string };

export type DeleteWorkItemError =
  | { type: 'checkpoint_cleanup_failed'; message: string }
  | SoloRemovalRefusal
  | LaneRemovalRefusal;
