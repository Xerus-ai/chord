import { err, ok } from '@shared/result';
import { resolveWorkspace } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';

/**
 * The `rpc.git.*` procedures that change the index or the working tree:
 * stage, unstage and discard. Spread into `gitController`, so the RPC
 * surface is one namespace whichever file a procedure lives in.
 */
export const workingTreeProcedures = {
  stageFile: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageFiles([filePath]);
      capture('vcs_files_staged', {
        count: 1,
        scope: 'single',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageFile failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageFiles(filePaths);
      capture('vcs_files_staged', {
        count: filePaths.length,
        scope: filePaths.length === 1 ? 'single' : 'multiple',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageFiles failed', { projectId, workspaceId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageAllFiles: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const unstaged = await env.git.getUnstagedChanges();
      await env.git.stageAllFiles();
      capture('vcs_files_staged', {
        count: unstaged.changes.length,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageAllFiles failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageFile: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageFiles([filePath]);
      capture('vcs_files_unstaged', {
        count: 1,
        scope: 'single',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageFile failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageFiles(filePaths);
      capture('vcs_files_unstaged', {
        count: filePaths.length,
        scope: filePaths.length === 1 ? 'single' : 'multiple',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageFiles failed', { projectId, workspaceId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageAllFiles: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const staged = await env.git.getStagedChanges();
      await env.git.unstageAllFiles();
      capture('vcs_files_unstaged', {
        count: staged.changes.length,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageAllFiles failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFile: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.revertFiles([filePath]);
      capture('vcs_files_discarded', {
        count: 1,
        scope: 'single',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertFile failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.revertFiles(filePaths);
      capture('vcs_files_discarded', {
        count: filePaths.length,
        scope: filePaths.length === 1 ? 'single' : 'multiple',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertFiles failed', { projectId, workspaceId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertAllFiles: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const status = await env.git.getStatus();
      const changedCount = new Set(status.changes.map((change) => change.path)).size;
      await env.git.revertAllFiles();
      capture('vcs_files_discarded', {
        count: changedCount,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertAllFiles failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },
};
