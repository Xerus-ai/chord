import { defineEvent } from '@shared/ipc/events';
import type { LaneProvisionError } from '@shared/work-item-provision-error';

/** Worktree acquisition transitions for a work item created under the
 *  non-blocking flow — lets the sidebar/chat flip from "Setting up
 *  workspace…" the moment provisioning lands instead of on the next poll. */
export const workItemProvisionChangedChannel = defineEvent<{
  workItemId: string;
  provisionStatus: 'provisioning' | 'ready' | 'failed';
  error?: LaneProvisionError;
}>('work-item:provision-changed');

export type LaneSetupStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

/** A lane's `.chord.json` setup moved to a new state (worktrees/lane-setup.ts). */
export const laneSetupChangedChannel = defineEvent<{
  worktreeId: string;
  workItemId: string;
  status: LaneSetupStatus;
}>('lane:setup-changed');
