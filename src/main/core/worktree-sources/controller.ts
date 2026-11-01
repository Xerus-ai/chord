import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import type { AdoptWorktreeSession } from '@shared/worktree-sources';
import { updateJustMeSettings } from '@main/core/repo-config/repo-settings-writes';
import { resolveImportSender } from '@main/core/session-import/import-sender';
import { listFolderImportableSessions } from '@main/core/session-import/list-work-item-sessions';
import { notifyLaneChanged } from '@main/core/worktrees/lane-readiness';
import {
  acquireWorktreeWorkspace,
  releaseWorktreeWorkspace,
} from '@main/core/worktrees/workspace-bridge';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { log } from '@main/lib/logger';
import { adoptWorktree } from './adopt-worktree';
import { listAllRepoWorktreeSources } from './list-worktree-sources';
import { pointLaneAtFolder } from './point-lane-at-folder';

/**
 * Registers the lane's workspace so its Explorer, Source Control and
 * terminals are served. Like a new lane's (`work-item-provisioning.ts`), a
 * failure leaves the panels without a backend until the next boot and must
 * not undo what the user asked for.
 */
async function acquireLaneWorkspace(laneId: string): Promise<void> {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} does not exist`);
  notifyLaneChanged(row.id);
  try {
    await acquireWorktreeWorkspace(row);
  } catch (error) {
    log.warn('[worktree-sources] could not acquire the workspace of an adopted lane', {
      laneId,
      error: String(error),
    });
  }
}

export const worktreeSourcesController = createRPCController({
  /** Every registered repository's checkouts Chord did not make, for the left rail. */
  list: async () => ok(await listAllRepoWorktreeSources()),

  /** The agent sessions found in a folder, for Adopt's dialog. */
  listFolderSessions: async (folder: string) =>
    ok(await listFolderImportableSessions([{ worktreeId: folder, path: folder }])),

  adopt: async (args: {
    repoId: string;
    path: string;
    name: string;
    sessions: AdoptWorktreeSession[];
  }) => {
    const result = await adoptWorktree({ ...args, sender: await resolveImportSender() });
    if (result.success) await acquireLaneWorkspace(result.data.worktreeId);
    return result;
  },

  /** A `stale_lane` refusal's action: the lane moves to the folder now holding its branch. */
  pointLaneAtFolder: async (args: { laneId: string; path: string }) => {
    const result = await pointLaneAtFolder(args);
    if (!result.success) return result;
    // The workspace still serves the old, missing folder. The lane is adopted
    // by now, so releasing it runs no teardown.
    await releaseWorktreeWorkspace(args.laneId);
    await acquireLaneWorkspace(args.laneId);
    return result;
  },

  /** "Hide for this repo": no "Review N worktrees" line for this repository. */
  hideReview: async (repoId: string) =>
    ok(updateJustMeSettings(repoId, { hideWorktreeReview: true })),
});
