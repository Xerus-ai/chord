// First: its module-start mark must precede every other module's evaluation.
import { markBoot, reportBoot } from './app/boot-timing';
import 'dotenv/config';
// Must precede every import that reaches esbuild (see the module).
import './core/artifact-pages/esbuild-binary-path';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dockIcon from '@/assets/images/chord/app-icon-mac.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { setupApplicationMenu } from './app/menu';
import { resolveProfileDir } from './app/profile';
import { registerPrivilegedSchemes, setupAppProtocol } from './app/protocol';
import { ignoreClosedStdioReaders } from './app/stdio';
import { createMainWindow } from './app/window';
import { providerTokenRegistry } from './core/account/provider-token-registry';
import { chordAccountService } from './core/account/services/chord-account-service';
import { registerProtocolHandler } from './core/account/services/workos-auth-service';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { appService } from './core/app/service';
import { setupArtifactPageProtocol } from './core/artifact-pages/artifact-page-protocol';
import { configureArtifactRuntimeDir } from './core/artifact-pages/artifact-runtime-dir';
import { commandInboxService } from './core/commands/command-inbox-service';
import { deviceSocketService } from './core/commands/device-socket-service';
import { permissionPublicationService } from './core/commands/permission-publication-service';
import { planPublicationService } from './core/commands/plan-publication-service';
import { openProtocolUrl } from './core/deep-links/open-protocol-url';
import { findProtocolUrlInArgv } from './core/deep-links/parse-deep-link';
import { localDependencyManager } from './core/dependencies/dependency-manager';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { gitWatcherRegistry } from './core/git/git-watcher-registry';
import { githubConnectionService } from './core/github/services/github-connection-service';
import { hasActiveLaneRuns, stopEveryLaneRun } from './core/lane-runs/lane-run-registry';
import { projectManager } from './core/projects/project-manager';
import { prSyncScheduler } from './core/pull-requests/pr-sync-scheduler';
import { repoIconBackfill } from './core/repos/repo-icon-backfill';
import { appSettingsService } from './core/settings/settings-service';
import { hasSoloHolds, recoverSoloSlotsOnBoot, settleSoloOnQuit } from './core/solo/solo-boot';
import { updateService } from './core/updates/update-service';
import { gitStateCaptureService } from './core/work-items/git-state-capture';
import { flushAllPartialTurns, initializeSessions } from './core/work-items/session-service';
import { startSharedRegistrySync } from './core/work-items/shared-registry-sync';
import { syncQueueService } from './core/work-items/sync-queue-service';
import { onWorkItemCloudCreated } from './core/work-items/work-item-cloud-created';
import { workspaceRegistry } from './core/workspaces/workspace-registry';
import { reconcileLanesOnStartup } from './core/worktrees/reconcile-lanes-on-startup';
import { acquireActiveWorktreeWorkspaces } from './core/worktrees/workspace-bridge';
import { initializeDatabase } from './db/initialize';
import { log } from './lib/logger';
import * as telemetry from './lib/telemetry';
import { rpcRouter } from './rpc';
import { resolveUserEnv } from './utils/userEnv';

markBoot('modules-evaluated');
ignoreClosedStdioReaders();

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

registerPrivilegedSchemes();
registerProtocolHandler();

app.setName(PRODUCT_NAME);
app.setPath('userData', resolveProfileDir());

app.on('second-instance', (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();

  const protocolUrl = findProtocolUrlInArgv(argv);
  if (protocolUrl) {
    openProtocolUrl(protocolUrl);
  }
});

app.on('open-url', (_event, url) => {
  if (url.startsWith('chord://')) {
    openProtocolUrl(url);
  }
});

if (!import.meta.env.DEV && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// A cold start from a link (Windows, Linux) carries the URL in argv; macOS
// delivers it through `open-url` above. Either way it waits in the deep-link
// router until the renderer claims it.
const coldStartProtocolUrl = findProtocolUrlInArgv(process.argv);
if (coldStartProtocolUrl) openProtocolUrl(coldStartProtocolUrl);

if (import.meta.env.DEV) {
  try {
    app.dock?.setIcon(dockIcon);
  } catch (err) {
    log.warn('Failed to set dock icon:', err);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

void app.whenReady().then(async () => {
  markBoot('ready');
  await resolveUserEnv();

  try {
    await initializeDatabase();
    reconcileLanesOnStartup();
    initializeSessions();
    void editorBufferService.pruneStale();
    // Not awaited: acquiring every active work item's worktree workspaces
    // must not sit on the window-show critical path. Rejections are per-row
    // isolated inside acquireActiveWorktreeWorkspaces itself; this catch is
    // only for a failure of the whole pass (e.g. the DB query itself).
    void acquireActiveWorktreeWorkspaces().catch((error) => {
      log.error('Failed to acquire active worktree workspaces at boot:', error);
    });
    // A Solo hold the previous run left: released, or shown as interrupted.
    // Per-repository isolated inside; this catch is for the pass itself.
    void recoverSoloSlotsOnBoot().catch((error) => {
      log.error('Failed to settle Solo holds at boot:', error);
    });
  } catch (error) {
    log.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database Initialization Failed',
      `${PRODUCT_NAME} could not start because the database failed to initialize.\n\n${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
    return;
  }

  markBoot('db-initialized');
  try {
    await telemetry.init({ installSource: app.isPackaged ? 'dmg' : 'dev' });
  } catch (e) {
    log.warn('telemetry init failed:', e);
  }

  gitWatcherRegistry.initialize();
  prSyncScheduler.initialize();
  syncQueueService.initialize();
  // For the app's lifetime; registered before the first shared-set refresh.
  startSharedRegistrySync();
  gitStateCaptureService.initialize();
  commandInboxService.initialize();
  deviceSocketService.initialize();
  // A new item's room is joined once the cloud has it, not on the next sweep.
  onWorkItemCloudCreated((workItemId) => deviceSocketService.joinWorkItemRoom(workItemId));
  appService.initialize();
  await appSettingsService.initialize();

  agentHookService.initialize().catch((e) => {
    log.error('Failed to start agent event service:', e);
  });

  chordAccountService
    .loadSessionToken()
    .then(() => {
      void syncQueueService.reconcileLocalWorkItems();
      void syncQueueService.reconcileLocalArtifacts();
      void syncQueueService.reconcileLocalChatMessages();
      // Sessions never survive a restart: any permission request still
      // published as pending is a retraction the previous run left owed.
      permissionPublicationService.reconcileOnStartup();
      planPublicationService.reconcileOnStartup();
      // The device socket's first connect attempt raced this token load and
      // saw signed-out — connect now instead of waiting out its retry timer.
      deviceSocketService.kick();
    })
    .catch((e) => {
      log.warn('Failed to load account session token:', e);
    });

  providerTokenRegistry.register('github', (token) => githubConnectionService.storeToken(token));

  markBoot('services-initialized');
  registerRPCRouter(rpcRouter, ipcMain);

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  const artifactRuntimeDir = join(app.getAppPath(), 'out', 'artifact-runtime');
  configureArtifactRuntimeDir(artifactRuntimeDir);
  setupArtifactPageProtocol(artifactRuntimeDir);
  setupApplicationMenu();
  markBoot('window-create');
  const window = createMainWindow();
  window.webContents.once('did-finish-load', () => {
    markBoot('did-finish-load');
    reportBoot();
    // After the renderer has loaded: each version probe spawns a process, and
    // a spawn holds the main thread (~25ms on Windows), which also serves the
    // renderer's assets. Results stream to the renderer as they land.
    localDependencyManager.probeAll().catch((e) => {
      log.error('Failed to probe dependencies:', e);
    });
  });

  // After the window exists, so a repo whose icon lands mid-walk can be
  // announced to the renderer rather than waiting for the next read. Kept out
  // of `initializeDatabase` deliberately: this is a bounded network walk, not
  // schema work, and a failure here must not stop the app from starting.
  repoIconBackfill.initialize();

  try {
    await updateService.initialize();
  } catch (error) {
    if (app.isPackaged) {
      log.error('Failed to initialize auto-update service:', error);
    }
  }
});

// Quitting kills a lane's processes with the app; a run script is stopped as
// Stop stops it instead (Ctrl+C, then the tree kill), so an attached
// `docker compose up` brings its containers down. The first quit waits for
// that and then quits again. A Solo root left unchanged is then released, so
// the user's checkout is back on its branch while the app is closed.
let laneRunsStoppedForQuit = false;

app.on('before-quit', (event) => {
  if (!laneRunsStoppedForQuit && (hasActiveLaneRuns() || hasSoloHolds())) {
    event.preventDefault();
    void stopEveryLaneRun()
      .then(() => settleSoloOnQuit())
      .finally(() => {
        laneRunsStoppedForQuit = true;
        app.quit();
      });
    return;
  }
  flushAllPartialTurns();
  telemetry.capture('app_closed');
  telemetry.shutdown();

  agentHookService.dispose();
  updateService.dispose();
  prSyncScheduler.dispose();
  syncQueueService.dispose();
  gitStateCaptureService.dispose();
  deviceSocketService.dispose();
  commandInboxService.dispose();
  void gitWatcherRegistry.dispose();
  projectManager.dispose().catch((e) => {
    log.error('Failed to shutdown project manager:', e);
  });
  // 'detach': app quit is not a work item deletion or archive — teardown
  // scripts must not run, just release the held resources (ptys, watchers).
  workspaceRegistry.releaseAll('detach').catch((e) => {
    log.error('Failed to release workspace registry:', e);
  });
});
