import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { eq } from 'drizzle-orm';
import { resolvePermissionMode } from '@shared/agent-control-catalog';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { getAgentControlCatalog } from '@main/core/agent-catalog/catalog-service';
import { seedDefaultPermissionMode } from '@main/core/agent-sessions/default-permission-mode';
import { getChatPermissionMode } from '@main/core/agent-sessions/permission-mode-store';
import { resolveChatLaunchConfig } from '@main/core/agent-sessions/session-config-store';
import { recordLaunchedModel } from '@main/core/agent-sessions/session-launch-model';
import { buildClaudeProjectGate } from '@main/core/claude-sdk/claude-project-gate';
import { appSettingsService } from '@main/core/settings/settings-service';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { resolveAgentStartApproval } from '@main/core/worktrees/lane-agent-start';
import { resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { agentSessions, workItems } from '@main/db/schema-work-items';
import type { ActiveSession, TransportMode } from './active-sessions';
import {
  getResumableExternalId,
  hasChatStarted,
  markChatStarted,
  recordChatExternalId,
} from './chat-resume-state';
import { launchAcpProcess } from './launch-acp-session-process';
import { launchClaudeSDKProcess } from './launch-claude-sdk-session';
import { launchCodexProcess } from './launch-codex-session-process';
import { launchPtyProcess } from './launch-pty-session';

export interface StartSessionOptions {
  cwd: string;
  providerId: AgentProviderId;
  kind: 'chat' | 'terminal';
  initialPrompt?: string;
  isResuming?: boolean;
  externalSessionId?: string;
  /** The lane environment (`resolveSessionLaneEnv`) — every transport gets it. */
  taskEnvVars: Record<string, string>;
}

export type AgentTransport = Exclude<TransportMode, 'shell'>;

/** How a session of `providerId` and `kind` talks to its agent. */
export function resolveTransport(
  providerId: AgentProviderId,
  kind: 'chat' | 'terminal'
): AgentTransport {
  // Data model: terminal = pty. A terminal session is an interactive CLI in a
  // real PTY for every provider; only chat sessions use structured transports.
  if (kind === 'terminal') return 'pty';
  if (providerId === 'claude') return 'claude-sdk';
  const providerDef = getProvider(providerId);
  if (providerDef?.communication === 'app-server') return 'codex-app-server';
  if (providerDef?.communication === 'acp' && providerDef?.acpConfig) return 'acp';
  return 'pty';
}

/**
 * Starts the agent process for a session over `transport` and returns the
 * session as it should be registered live. Registration, the spawn guard and
 * teardown stay with `session-service`, which owns the session's lifecycle.
 */
export async function launchSessionTransport(
  transport: AgentTransport,
  sessionId: string,
  workItemId: string,
  opts: StartSessionOptions,
  callbacks: { onExit: (exitCode: number | undefined) => void }
): Promise<ActiveSession> {
  // Every transport launches with the session's model/effort override, else
  // the work item's selection — resolved per provider, so a value left behind
  // by another agent (the columns survive agent switches) falls back to the
  // provider default instead of reaching a CLI that would reject it. The same
  // resolution runs in deliverToLiveSession's restart check; they must agree
  // or a live session restarts on every send.
  const [workItem] = db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1).all();
  const catalog = await getAgentControlCatalog(opts.providerId, sessionId);
  if (opts.kind === 'chat') await seedDefaultPermissionMode(workItemId, sessionId, opts.providerId);
  const launchConfig = resolveChatLaunchConfig(catalog, workItem, sessionId);
  const model = launchConfig.model ?? undefined;
  const effort = launchConfig.effort ?? undefined;

  // One write for every transport, because every transport launches from the
  // resolved config above. The session's own row is the only place that still
  // answers "what did this run with" once it reaches 'done' — the kv override
  // store is deleted at that point. See session-launch-model.ts.
  recordLaunchedModel(sessionId, launchConfig.model);

  // Read once per launch: toggling "Let agents create artifacts" applies to
  // sessions started afterwards, never to one mid-conversation.
  const artifactSettings = await appSettingsService.get('artifacts');
  const artifactTools = artifactSettings.enabled
    ? { preferredFormat: artifactSettings.preferredFormat }
    : null;

  switch (transport) {
    case 'claude-sdk': {
      // Asks about the repository's Claude config if it is unapproved; after
      // Don't run the gate keeps it from running (guidance still loads).
      const start = await resolveAgentStartApproval(
        resolveSessionWorktreeRow(sessionId).id,
        { claudeSession: true, shell: false, platform: process.platform },
        askScriptApproval
      );
      const projectGate = buildClaudeProjectGate({
        claude: start.claude,
        approved: start.approved,
      });
      const r = await launchClaudeSDKProcess(
        sessionId,
        {
          workItemId,
          cwd: opts.cwd,
          providerId: opts.providerId,
          kind: opts.kind,
          initialPrompt: opts.initialPrompt,
          model,
          // Narrowed against the probed catalog, whose levels are the SDK's own.
          effort: effort as EffortLevel | undefined,
          fast: launchConfig.fast,
          // Resolved against the probed catalog, whose ids are the SDK's own.
          permissionMode:
            opts.kind === 'chat'
              ? (resolvePermissionMode(
                  catalog,
                  launchConfig.model,
                  getChatPermissionMode(workItemId, sessionId)
                )?.id as PermissionMode | undefined)
              : undefined,
          artifactTools,
          projectGate,
          isResuming: opts.isResuming,
          externalSessionId: opts.externalSessionId,
          previouslyStarted: hasChatStarted(sessionId),
          resumableExternalId: getResumableExternalId(sessionId),
          env: opts.taskEnvVars,
          onSessionId: (id) => recordChatExternalId(sessionId, id),
        },
        callbacks
      );
      r.bridge.setUnpublishedDocumentChips(artifactSettings.enabled);
      const session: ActiveSession = {
        sessionId,
        workItemId,
        providerId: opts.providerId,
        mode: 'claude-sdk',
        kind: opts.kind,
        bridge: r.bridge,
        chatHandle: r.handle,
        abortController: r.abortController,
        launch: launchConfig,
      };
      markChatStarted(sessionId);
      return session;
    }

    case 'acp': {
      const r = await launchAcpProcess(
        sessionId,
        {
          workItemId,
          cwd: opts.cwd,
          providerId: opts.providerId,
          kind: opts.kind,
          initialPrompt: opts.initialPrompt,
          externalSessionId: opts.externalSessionId,
          resolveSelection: (catalog) => resolveChatLaunchConfig(catalog, workItem, sessionId),
          permissionMode: getChatPermissionMode(workItemId, sessionId),
          artifactTools,
          env: opts.taskEnvVars,
        },
        callbacks
      );
      r.bridge.setUnpublishedDocumentChips(artifactSettings.enabled);
      const session: ActiveSession = {
        sessionId,
        workItemId,
        providerId: opts.providerId,
        mode: 'acp',
        kind: opts.kind,
        bridge: r.bridge,
        launch: r.launch,
      };
      if (r.externalSessionId) recordChatExternalId(sessionId, r.externalSessionId);
      return session;
    }

    case 'codex-app-server': {
      const r = await launchCodexProcess(
        sessionId,
        {
          workItemId,
          cwd: opts.cwd,
          providerId: opts.providerId,
          initialPrompt: opts.initialPrompt,
          externalSessionId: opts.externalSessionId,
          launch: launchConfig,
          permissionMode: () => getChatPermissionMode(workItemId, sessionId),
          artifactTools,
          env: opts.taskEnvVars,
          onSessionId: (id) => recordChatExternalId(sessionId, id),
        },
        callbacks
      );
      r.bridge.setUnpublishedDocumentChips(artifactSettings.enabled);
      const session: ActiveSession = {
        sessionId,
        workItemId,
        providerId: opts.providerId,
        mode: 'codex-app-server',
        kind: opts.kind,
        bridge: r.bridge,
        chatHandle: r.handle,
        launch: launchConfig,
      };
      return session;
    }

    case 'pty': {
      // The chat resume state is per session, for respawn-resume. Terminals
      // resume only their own external id (passed explicitly) and never
      // read or write the chat bookkeeping.
      const isChat = opts.kind === 'chat';
      const r = await launchPtyProcess(
        sessionId,
        {
          workItemId,
          cwd: opts.cwd,
          providerId: opts.providerId,
          kind: opts.kind,
          initialPrompt: opts.initialPrompt,
          isResuming: opts.isResuming,
          externalSessionId:
            opts.externalSessionId ?? (isChat ? getResumableExternalId(sessionId) : undefined),
          previouslyStarted: isChat && hasChatStarted(sessionId),
          taskEnvVars: opts.taskEnvVars,
          // Model/effort are a chat-session setting; terminals are the
          // user's own CLI to configure.
          model: isChat ? model : undefined,
          effort: isChat ? effort : undefined,
          artifactTools,
        },
        callbacks
      );
      if (isChat) markChatStarted(sessionId);
      const session: ActiveSession = {
        sessionId,
        workItemId,
        providerId: opts.providerId,
        mode: 'pty',
        kind: opts.kind,
        launch: isChat ? launchConfig : undefined,
      };
      db.update(agentSessions)
        .set({ externalSessionId: r.externalSessionId })
        .where(eq(agentSessions.id, sessionId))
        .run();
      if (isChat) recordChatExternalId(sessionId, r.externalSessionId);
      return session;
    }
  }
}
