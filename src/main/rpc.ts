import { createRPCRouter } from '../shared/ipc/rpc';
import { accountController } from './core/account/controller';
import { acpController } from './core/acp/controller';
import { agentCatalogController } from './core/agent-catalog/controller';
import { agentSessionsController } from './core/agent-sessions/controller';
import { appController } from './core/app/controller';
import { artifactFilesController } from './core/artifact-files/controller';
import { artifactPagesController } from './core/artifact-pages/controller';
import { artifactsController } from './core/artifacts/controller';
import { chatHistoryController } from './core/chat-history/controller';
import { chatMessagesController } from './core/chat-messages/controller';
import { checkpointsController } from './core/checkpoints/controller';
import { confluenceController } from './core/confluence/controller';
import { createFromController } from './core/create-from/controller';
import { deepLinksController } from './core/deep-links/controller';
import { dependenciesController } from './core/dependencies/controller';
import { editorBufferController } from './core/editor/controller';
import { feedbackController } from './core/feedback/controller';
import { filesController } from './core/fs/controller';
import { gitAiController } from './core/git-ai/controller';
import { gitController } from './core/git/controller';
import { githubController } from './core/github/controller';
import { issueController } from './core/issues/controller';
import { jiraController } from './core/jira/controller';
import { laneRunsController } from './core/lane-runs/controller';
import { linearController } from './core/linear/controller';
import { mcpController } from './core/mcp/controller';
import { notificationPreferencesController } from './core/notification-preferences/controller';
import { openRouterController } from './core/openrouter/controller';
import { projectController } from './core/projects/controller';
import { providerUsageController } from './core/provider-usage/controller';
import { ptyController } from './core/pty/controller';
import { pullRequestController } from './core/pull-requests/controller';
import { repoSettingsController } from './core/repo-config/controller';
import { reposController } from './core/repos/controller';
import { repositoryController } from './core/repository/controller';
import { sessionImportController } from './core/session-import/controller';
import { appSettingsController } from './core/settings/controller';
import { providerSettingsController } from './core/settings/provider-settings-controller';
import { skillsController } from './core/skills/controller';
import { soloController } from './core/solo/controller';
import { sshController } from './core/ssh/controller';
import { telemetryController } from './core/telemetry/controller';
import { terminalShellsController } from './core/terminal-shells/controller';
import { updateController } from './core/updates/controller';
import { viewStateController } from './core/view-state/controller';
import { workItemsController } from './core/work-items/controller';
import { syncQueueController } from './core/work-items/sync-queue-controller';
import { workItemTicketsController } from './core/work-items/tickets-controller';
import { worktreeSourcesController } from './core/worktree-sources/controller';
import { worktreesController } from './core/worktrees/controller';

export const rpcRouter = createRPCRouter({
  acp: acpController,
  agentCatalog: agentCatalogController,
  account: accountController,
  agentSessions: agentSessionsController,
  artifactFiles: artifactFilesController,
  artifactPages: artifactPagesController,
  artifacts: artifactsController,
  confluence: confluenceController,
  createFrom: createFromController,
  deepLinks: deepLinksController,
  chatMessages: chatMessagesController,
  chatHistory: chatHistoryController,
  checkpoints: checkpointsController,
  app: appController,
  appSettings: appSettingsController,
  providerSettings: providerSettingsController,
  providerUsage: providerUsageController,
  repository: repositoryController,
  fs: filesController,
  update: updateController,
  pty: ptyController,
  github: githubController,
  issues: issueController,
  jira: jiraController,
  laneRuns: laneRunsController,
  solo: soloController,
  linear: linearController,
  skills: skillsController,
  ssh: sshController,
  projects: projectController,
  git: gitController,
  gitAi: gitAiController,
  dependencies: dependenciesController,
  mcp: mcpController,
  openRouter: openRouterController,
  editorBuffer: editorBufferController,
  feedback: feedbackController,
  telemetry: telemetryController,
  terminalShells: terminalShellsController,
  pullRequests: pullRequestController,
  repos: reposController,
  repoSettings: repoSettingsController,
  sessionImport: sessionImportController,
  notificationPreferences: notificationPreferencesController,
  syncQueue: syncQueueController,
  viewState: viewStateController,
  workItems: workItemsController,
  workItemTickets: workItemTicketsController,
  worktrees: worktreesController,
  worktreeSources: worktreeSourcesController,
});

export type RpcRouter = typeof rpcRouter;
