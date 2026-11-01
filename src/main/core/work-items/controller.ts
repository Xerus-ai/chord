import { readFile, stat } from 'node:fs/promises';
import { desc } from 'drizzle-orm';
import type { CreateWorkItemArgs } from '@shared/create-work-item';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { commitAndPushWorkItem, pushWorkItemBranch } from './commit-and-push';
import { readDashboardLinks } from './dashboard-links';
import { discardWorkItemFileChanges, revertWorkItemFile, stageWorkItemFile } from './file-revert';
import { previewWorkItemBranch } from './preview-work-item-branch';
import { confineToCheckout, writeRepoFileAt } from './repo-file-path';
import { resolveWorkItemBranchInfo } from './resolve-branch-info';
import { collectSidebarSummaries } from './sidebar-summaries';
import { loadWorkItem, resolveCheckoutPath, resolveWorkItemCheckout } from './work-item-checkout';
import {
  createWorkItem,
  deleteWorkItem,
  retryWorkItemProvisioning,
  updateWorkItem,
} from './work-item-crud';
import type { RetryProvisionOptions, UpdateWorkItemArgs } from './work-item-crud-types';
import {
  readChangedFiles,
  readFileDiff,
  readGitLog,
  readRepoFileList,
} from './work-item-git-reads';
import { readPrInfoForBranch } from './work-item-pr-info';
import { pickWorktreePath } from './work-item-worktree-path';

function gitError(error: unknown) {
  return { type: 'git_error' as const, message: String(error) };
}

export const workItemsController = createRPCController({
  getAll: async () => {
    const rows = await db.select().from(workItems).orderBy(desc(workItems.createdAt));
    return ok({ items: rows });
  },

  create: (args: CreateWorkItemArgs) => createWorkItem(args),

  /** The create dialog's `Branch:` line for this name and the id it will create with. */
  previewBranchName: (args: { name: string; workItemId: string }) => previewWorkItemBranch(args),

  retryProvision: (id: string, options?: RetryProvisionOptions) =>
    retryWorkItemProvisioning(id, options),

  update: async (args: UpdateWorkItemArgs) => ok(await updateWorkItem(args)),

  remove: (id: string) => deleteWorkItem(id),

  getGitStatus: async (workItemId: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;
    try {
      return ok({ files: await readChangedFiles(checkout.data) });
    } catch (error) {
      return err(gitError(error));
    }
  },

  revertFile: async (workItemId: string, filePath: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    try {
      await revertWorkItemFile(row.repoPath, filePath);
      return ok();
    } catch (error) {
      return err(gitError(error));
    }
  },

  listRepoFiles: async (workItemId: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    try {
      return ok({ files: await readRepoFileList(row.repoPath) });
    } catch (error) {
      return err(gitError(error));
    }
  },

  getGitLog: async (workItemId: string, maxCount?: number, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;
    try {
      return ok({ commits: await readGitLog(checkout.data, maxCount ?? 10) });
    } catch (error) {
      return err(gitError(error));
    }
  },

  getGitBranchInfo: async (workItemId: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;
    try {
      return ok(await resolveWorkItemBranchInfo(checkout.data));
    } catch (error) {
      return err(gitError(error));
    }
  },

  /** The PR of the branch checked out in the worktree (the primary's when none is named). */
  getPrInfo: async (workItemId: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const worktree = worktreeId === undefined ? undefined : findWorktreeRow(worktreeId);
    const checkout = pickWorktreePath(row, worktreeId, worktree);
    if (!checkout.success) return checkout;
    try {
      const { currentBranch } = await resolveWorkItemBranchInfo(checkout.data);
      return ok({ pr: await readPrInfoForBranch(checkout.data, currentBranch) });
    } catch (error) {
      return err(gitError(error));
    }
  },

  getFileDiff: async (workItemId: string, filePath: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;
    try {
      const { original, modified } = await readFileDiff(checkout.data, filePath);
      return ok({ original, modified, filePath });
    } catch (error) {
      return err(gitError(error));
    }
  },

  readRepoFile: async (workItemId: string, filePath: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;

    // File paths arrive from rendered agent output — confine reads to the
    // resolved worktree's checkout no matter what the path claims.
    const absolute = confineToCheckout(checkout.data, filePath);
    if (absolute === null) return err({ type: 'outside_repo' as const });

    try {
      const stats = await stat(absolute);
      if (stats.size > 2 * 1024 * 1024) {
        return err({ type: 'too_large' as const, size: stats.size });
      }
      const content = await readFile(absolute, 'utf-8');
      return ok({ content, filePath });
    } catch (error) {
      return err({ type: 'read_error' as const, message: String(error) });
    }
  },

  /** Edit mode's save (design 2026-09-26 §3): rewrites a file the tab opened, never creates one. */
  writeRepoFile: async (
    workItemId: string,
    filePath: string,
    content: string,
    worktreeId?: string
  ) => {
    const checkout = await resolveWorkItemCheckout(workItemId, worktreeId);
    if (!checkout.success) return checkout;
    return writeRepoFileAt(checkout.data, filePath, content);
  },

  stageFile: async (workItemId: string, filePath: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;
    try {
      await stageWorkItemFile(checkout.data, filePath);
      return ok();
    } catch (error) {
      return err(gitError(error));
    }
  },

  // "Undo All" in the diff viewer: the file goes back to HEAD whether or not
  // "Apply All" already staged it.
  restoreFile: async (workItemId: string, filePath: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;
    try {
      await discardWorkItemFileChanges(checkout.data, filePath);
      return ok();
    } catch (error) {
      return err(gitError(error));
    }
  },

  getSidebarSummaries: async (ids: string[]) => {
    return ok({ summaries: await collectSidebarSummaries(ids) });
  },

  getDashboardLinks: async (ids: string[]) => {
    return ok({ links: await readDashboardLinks(ids) });
  },

  /** Commits and publishes the lane's checkout — the primary's when no worktree is named. */
  commitAndPush: async (workItemId: string, message: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;

    const commitMessage = message.trim();
    if (!commitMessage) return err({ type: 'empty_message' as const });

    try {
      await commitAndPushWorkItem(checkout.data, commitMessage);
      return ok();
    } catch (error) {
      return err(gitError(error));
    }
  },

  /** Publish the lane's branch as-is — what opening a PR needs on a clean worktree. */
  pushBranch: async (workItemId: string, worktreeId?: string) => {
    const row = await loadWorkItem(workItemId);
    if (!row) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(row, worktreeId);
    if (!checkout.success) return checkout;

    try {
      await pushWorkItemBranch(checkout.data);
      return ok();
    } catch (error) {
      return err(gitError(error));
    }
  },
});
