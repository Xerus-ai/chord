import type { RunScriptMap } from '@shared/run-scripts';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService, type RepoSettingsReader } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { LifecycleScriptService } from '@main/core/workspaces/workspace-lifecycle-service';
import { type WorkspaceFactoryResult } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import { TimeoutSignal, withTimeout } from '../projects/utils';

const TEARDOWN_SCRIPT_WAIT_MS = 10_000;

export type WorkspaceType =
  | { kind: 'local' }
  | { kind: 'ssh'; proxy: SshClientProxy; connectionId: string };

type WorkspaceFactoryContext = {
  workDir: string;
  projectId: string;
  settings: RepoSettingsReader;
  /** The lane environment (`buildLaneEnv`) every script in this workspace runs with. */
  laneEnv: Record<string, string>;
  /**
   * The repository scripts this workspace may run, resolved each time one
   * would run — never captured at acquire, so an approval given later applies
   * at once and a change on the target ref stops them
   * (`worktrees/lane-config.ts` `resolveApprovedLaneScripts`). Setup is not
   * here — it is lane state (`worktrees/lane-setup.ts`).
   */
  resolveScripts: () => Promise<{
    shellSetup?: string;
    /** By script id (`@shared/run-scripts`). */
    run: RunScriptMap;
    test?: string;
    teardown?: string;
  }>;
  tmux: boolean;
  logPrefix: string;
  /** Inject an existing repository service. When absent, the factory creates one. */
  repository?: GitRepositoryService;
  /** Inject an existing fetch service. Lifecycle is only managed for one the factory creates. */
  fetchService?: GitFetchService;
  extraHooks?: {
    onCreate?: (ws: Workspace) => Promise<void>;
    onDestroy?: (ws: Workspace) => Promise<void>;
    onDetach?: (ws: Workspace) => Promise<void>;
  };
};

/**
 * Returns a factory function suitable for passing to `WorkspaceRegistry.acquire`.
 * Handles transport-specific construction (local vs SSH) and wires the run and
 * teardown lifecycle scripts. Provider-specific hooks are passed via `extraHooks`.
 */
export function createWorkspaceFactory(
  workspaceId: string,
  type: WorkspaceType,
  context: WorkspaceFactoryContext
): () => Promise<WorkspaceFactoryResult> {
  return async () => {
    const workDir = context.workDir;
    const resolveShellSetup = async () => (await context.resolveScripts()).shellSetup;

    const workspaceFs =
      type.kind === 'ssh' ? new SshFileSystem(type.proxy, workDir) : new LocalFileSystem(workDir);
    const ctx =
      type.kind === 'ssh' ? new SshExecutionContext(type.proxy) : new LocalExecutionContext();

    // Transport-specific workspace terminal provider (used only by lifecycle scripts)
    const workspaceTerminals =
      type.kind === 'ssh'
        ? new SshTerminalProvider({
            projectId: context.projectId,
            scopeId: workspaceId,
            taskPath: workDir,
            tmux: context.tmux,
            resolveShellSetup,
            ctx,
            proxy: type.proxy,
            connectionId: type.connectionId,
            taskEnvVars: context.laneEnv,
          })
        : new LocalTerminalProvider({
            projectId: context.projectId,
            scopeId: workspaceId,
            taskPath: workDir,
            tmux: context.tmux,
            resolveShellSetup,
            ctx,
            taskEnvVars: context.laneEnv,
          });

    const lifecycleService = new LifecycleScriptService({
      projectId: context.projectId,
      workspaceId,
      terminals: workspaceTerminals,
    });

    const baseGitCtx =
      type.kind === 'ssh'
        ? new SshExecutionContext(type.proxy, { root: workDir })
        : new LocalExecutionContext({ root: workDir });
    const authGitCtx = new GitHubAuthExecutionContext(baseGitCtx, () =>
      githubConnectionService.getToken()
    );
    const gitService = new GitService(baseGitCtx, authGitCtx, workspaceFs);

    const repository = context.repository ?? new GitRepositoryService(gitService, context.settings);

    const ownsFetchService = !context.fetchService;
    const fetchService =
      context.fetchService ??
      new GitFetchService(
        gitService,
        async () => (await githubConnectionService.getToken()) !== null
      );

    const workspace: Workspace = {
      id: workspaceId,
      path: workDir,
      fs: workspaceFs,
      git: gitService,
      settings: context.settings,
      lifecycleService,
      repository,
      fetchService,
    };

    const { logPrefix } = context;

    return {
      workspace,

      // No lifecycle terminal is spawned ahead of time: spawning one runs the
      // repository's shellSetup, which must wait until something the user
      // approved actually runs. `runLifecycleScript` spawns on demand.
      onCreateSideEffect: () => {
        if (ownsFetchService) {
          fetchService.start();
        }
      },

      onCreate: context.extraHooks?.onCreate,

      onDestroy: async (ws) => {
        if (ownsFetchService) {
          fetchService.stop();
        }
        try {
          const { teardown } = await context.resolveScripts();
          if (teardown) {
            await withTimeout(
              ws.lifecycleService.runLifecycleScript(
                { type: 'teardown', script: teardown },
                { waitForExit: true }
              ),
              TEARDOWN_SCRIPT_WAIT_MS
            );
          }
        } catch (error) {
          if (error instanceof TimeoutSignal) {
            log.debug(`${logPrefix}: teardown script wait timed out`, {
              workspaceId,
              timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
            });
          } else {
            log.warn(`${logPrefix}: teardown script failed (continuing cleanup)`, {
              workspaceId,
              error: String(error),
            });
          }
        }
        await context.extraHooks?.onDestroy?.(ws);
      },

      onDetach: context.extraHooks?.onDetach
        ? (ws) => context.extraHooks!.onDetach!(ws)
        : undefined,
    };
  };
}
