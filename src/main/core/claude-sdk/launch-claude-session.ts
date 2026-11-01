import { existsSync } from 'node:fs';
import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { getAgentDisplayName } from '@shared/agent-display-name';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import { registerArtifactToolSession } from '@main/core/agent-artifact-tools/artifact-tool-sessions';
import { createChordMcpServer } from '@main/core/agent-artifact-tools/chord-mcp-server';
import { resolveClaudeResumeId } from '@main/core/agent-sessions/claude-conversation-store';
import { TransportError } from '@main/core/agent-sessions/errors';
import { reportPermissionMode } from '@main/core/agent-sessions/report-permission-mode';
import { recordSessionTelemetry } from '@main/core/agent-sessions/session-telemetry';
import { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';
import { recordProviderUsage } from '@main/core/provider-usage/provider-usage-store';
import { log } from '@main/lib/logger';
import { bridgeSDKEvent } from './bridge-sdk-events';
import type { ClaudeProjectGate } from './claude-project-gate';
import { startClaudeSDKSession, type ClaudeSDKSessionHandle } from './claude-sdk-session';

export interface ClaudeLaunchResult {
  bridge: AgentEventBridge;
  handle: ClaudeSDKSessionHandle;
  abortController: AbortController;
}

export async function launchClaudeSDK(
  sessionId: string,
  opts: {
    workItemId: string;
    cwd: string;
    providerId: AgentProviderId;
    initialPrompt?: string;
    model?: string;
    effort?: EffortLevel;
    fast: boolean;
    permissionMode?: PermissionMode;
    /** Settings › Agents › Artifacts at launch; null while "Let agents create artifacts" is off. */
    artifactTools: { preferredFormat: PreferredArtifactFormat } | null;
    projectGate: ClaudeProjectGate;
    isResuming?: boolean;
    resumeSessionId?: string;
    env: Record<string, string>;
    onSessionId: (externalSessionId: string) => void;
    onExit: (code: number) => void;
  }
): Promise<ClaudeLaunchResult> {
  if (!existsSync(opts.cwd)) {
    throw new TransportError(`Workspace path does not exist: ${opts.cwd}`, opts.providerId);
  }

  // Every chat launch resumes through here (a targeted send, a respawn, a
  // model change), so this is the one check that the conversation still exists.
  const resumeSessionId = resolveClaudeResumeId(
    opts.cwd,
    opts.isResuming === true,
    opts.resumeSessionId
  );
  if (opts.isResuming && resumeSessionId === undefined) {
    log.info('claude-sdk: conversation to resume is gone; starting fresh', {
      sessionId,
      externalSessionId: opts.resumeSessionId,
    });
  }

  const abortController = new AbortController();
  const bridge = new AgentEventBridge(getAgentDisplayName(opts.providerId));
  bridge.setSessionId(sessionId);
  bridge.startWatching(opts.workItemId, opts.cwd);

  // One token per session: the tool calls it serves land in this work item and
  // this live turn, and stop resolving the moment the session ends.
  const toolSession = opts.artifactTools
    ? registerArtifactToolSession({
        sessionId,
        workItemId: opts.workItemId,
        cwd: opts.cwd,
        preferredFormat: opts.artifactTools.preferredFormat,
        onPublished: (result) => bridge.recordPublishedArtifact(opts.workItemId, result),
      })
    : null;
  if (toolSession) abortController.signal.addEventListener('abort', toolSession.dispose);

  const chordMcpServer =
    toolSession && opts.artifactTools
      ? await createChordMcpServer(toolSession.token, opts.artifactTools.preferredFormat)
      : null;
  const handle = await startClaudeSDKSession({
    initialPrompt: opts.initialPrompt,
    cwd: opts.cwd,
    workItemId: opts.workItemId,
    model: opts.model,
    effort: opts.effort,
    fast: opts.fast,
    permissionMode: opts.permissionMode,
    projectGate: opts.projectGate,
    chordMcpServer,
    sessionId: resumeSessionId,
    isResuming: resumeSessionId !== undefined,
    env: opts.env,
    abortController,
    onEvent: (event) => {
      recordSessionTelemetry(sessionId, event);
      recordProviderUsage(opts.providerId, event);
      bridgeSDKEvent(bridge, opts.workItemId, event);
    },
    onSessionId: opts.onSessionId,
    onPermissionMode: (mode) => reportPermissionMode(opts.workItemId, sessionId, mode),
    onExit: (code) => {
      log.info('claude-sdk: session exited', { sessionId, code });
      toolSession?.dispose();
      bridge.stopWatching();
      if (code !== 0) {
        bridge.handleExit(opts.workItemId, code);
      }
      opts.onExit(code);
    },
  });

  bridge.setOnPlanModeChange((mode) => {
    if (mode === 'awaiting_approval') {
      handle.holdToolsForPlan();
    } else {
      handle.releaseToolsForPlan();
    }
  });

  log.info('claude-sdk: started session', { sessionId });

  return { bridge, handle, abortController };
}
