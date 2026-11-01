import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { log } from '@main/lib/logger';
import { archiveWorktree } from './archive-worktree';
import { listArchivedLanes } from './archived-lanes';
import { deleteWorktree } from './delete-worktree';
import { readWorktreeCommittedChanges } from './lane-committed-changes';
import { readLaneSetupLog, runLaneSetup } from './lane-setup';
import { restoreWorktree } from './restore-worktree';
import {
  createWorktree,
  inspectWorktreeArchive,
  listWorktrees,
  promoteWorktreeToPrimary,
  setWorktreeTitle,
} from './service';
import { findWorktreeRow } from './worktree-lookup';
import { resolveWorktreeProjectId } from './worktree-project-id';

export const worktreesController = createRPCController({
  list: async (workItemId: string, opts?: { includeArchived?: boolean }) => {
    try {
      return ok({ worktrees: await listWorktrees(workItemId, opts ?? {}) });
    } catch (e) {
      log.error('worktreesCtrl.list failed', { workItemId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  /** The `projectId` `git.*` RPCs for this worktree take (`repoId ?? mainRepoPath`). */
  getProjectId: async (worktreeId: string) => {
    try {
      const projectId = await resolveWorktreeProjectId(worktreeId);
      if (projectId === null) return err({ type: 'not_found' as const, worktreeId });
      return ok({ projectId });
    } catch (e) {
      log.error('worktreesCtrl.getProjectId failed', { worktreeId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  /** The lane's commits against its compare base (Settings › Git), for the Changes panel. */
  getCommittedChanges: async (worktreeId: string) => {
    const row = findWorktreeRow(worktreeId);
    if (!row) return err({ type: 'not_found' as const, worktreeId });
    try {
      return ok(await readWorktreeCommittedChanges(row));
    } catch (e) {
      log.error('worktreesCtrl.getCommittedChanges failed', { worktreeId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  create: async (args: { workItemId: string; title?: string; baseBranch?: string }) => {
    try {
      return await createWorktree(args);
    } catch (e) {
      log.error('worktreesCtrl.create failed', { ...args, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  /** Archive: checkout removed; branch, history and uncommitted work kept (`archive-worktree.ts`). */
  archive: async (args: { worktreeId: string; deleteBranch?: boolean }) => {
    try {
      return await archiveWorktree(args.worktreeId, { deleteBranch: args.deleteBranch });
    } catch (e) {
      log.error('worktreesCtrl.archive failed', { ...args, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  /** Restore: the archived lane's checkout back, with its kept work (`restore-worktree.ts`). */
  restore: async (worktreeId: string) => {
    try {
      return await restoreWorktree(worktreeId);
    } catch (e) {
      log.error('worktreesCtrl.restore failed', { worktreeId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  /** The work item's archived lanes, for the left rail's "Archived (n)" group. */
  listArchived: async (workItemId: string) => {
    try {
      return ok({ lanes: await listArchivedLanes(workItemId) });
    } catch (e) {
      log.error('worktreesCtrl.listArchived failed', { workItemId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  /** Deletes a secondary lane: checkout removed, branch kept (`delete-worktree.ts`). */
  remove: async (worktreeId: string) => {
    try {
      return await deleteWorktree(worktreeId);
    } catch (e) {
      log.error('worktreesCtrl.remove failed', { worktreeId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  setTitle: async (args: { worktreeId: string; title: string }) => {
    try {
      return await setWorktreeTitle(args.worktreeId, args.title);
    } catch (e) {
      log.error('worktreesCtrl.setTitle failed', { ...args, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  inspectArchive: async (worktreeId: string) => {
    try {
      return await inspectWorktreeArchive(worktreeId);
    } catch (e) {
      log.error('worktreesCtrl.inspectArchive failed', { worktreeId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },

  /** Re-runs a lane's setup (the provisioning bar's Retry). */
  retrySetup: async (worktreeId: string) => {
    if (!findWorktreeRow(worktreeId)) return err({ type: 'not_found' as const, worktreeId });
    return ok({ status: await runLaneSetup(worktreeId, askScriptApproval) });
  },

  getSetupLog: async (worktreeId: string) => {
    if (!findWorktreeRow(worktreeId)) return err({ type: 'not_found' as const, worktreeId });
    return ok({ log: await readLaneSetupLog(worktreeId) });
  },

  promoteToPrimary: async (worktreeId: string) => {
    try {
      return await promoteWorktreeToPrimary(worktreeId);
    } catch (e) {
      log.error('worktreesCtrl.promoteToPrimary failed', { worktreeId, error: String(e) });
      return err({ type: 'worktree_error' as const, message: String(e) });
    }
  },
});
