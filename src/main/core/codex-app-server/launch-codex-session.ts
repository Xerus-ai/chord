import { existsSync } from 'node:fs';
import type { CatalogSelection } from '@shared/agent-control-catalog';
import { getAgentDisplayName } from '@shared/agent-display-name';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import {
  chordCodexMcpServer,
  openChordMcpAccess,
} from '@main/core/agent-artifact-tools/chord-mcp-access';
import type { ChatSessionHandle } from '@main/core/agent-sessions/chat-handle';
import { TransportError } from '@main/core/agent-sessions/errors';
import type { ChatPermissionMode } from '@main/core/agent-sessions/permission-mode-store';
import { resolveAgentExecutable } from '@main/core/agent-sessions/resolve-agent-executable';
import { recordSessionTelemetry } from '@main/core/agent-sessions/session-telemetry';
import { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';
import { bridgeSDKEvent } from '@main/core/claude-sdk/bridge-sdk-events';
import { recordProviderUsage } from '@main/core/provider-usage/provider-usage-store';
import { log } from '@main/lib/logger';
import { startCodexSession } from './codex-session';

export interface CodexLaunchResult {
  bridge: AgentEventBridge;
  handle: ChatSessionHandle;
}

/**
 * Starts a Codex chat session on `codex app-server`: a new thread, or the
 * persisted one resumed. Resolves once the thread is ready; the initial
 * prompt's turn then runs on its own, so the session is live meanwhile.
 */
export async function launchCodexSession(
  sessionId: string,
  opts: {
    workItemId: string;
    cwd: string;
    providerId: AgentProviderId;
    initialPrompt?: string;
    resumeThreadId?: string;
    selection: CatalogSelection;
    permissionMode: () => ChatPermissionMode;
    /** Settings › Agents › Artifacts at launch; null while "Let agents create artifacts" is off. */
    artifactTools: { preferredFormat: PreferredArtifactFormat } | null;
    env: Record<string, string>;
    onThreadId: (threadId: string) => void;
    onExit: (code: number | null) => void;
  }
): Promise<CodexLaunchResult> {
  if (!existsSync(opts.cwd)) {
    throw new TransportError(`Workspace path does not exist: ${opts.cwd}`, opts.providerId);
  }
  const command = await resolveAgentExecutable({
    providerId: opts.providerId,
    cli: getProvider(opts.providerId)?.cli,
  });

  const bridge = new AgentEventBridge(getAgentDisplayName(opts.providerId));
  bridge.setSessionId(sessionId);
  bridge.startWatching(opts.workItemId, opts.cwd);

  // Codex reaches the chord tools over the loopback endpoint, configured on
  // the thread itself (plan 2026-09-23 P3); its own config file is not touched.
  const toolAccess = opts.artifactTools
    ? await openChordMcpAccess({
        sessionId,
        workItemId: opts.workItemId,
        cwd: opts.cwd,
        preferredFormat: opts.artifactTools.preferredFormat,
        onPublished: (result) => bridge.recordPublishedArtifact(opts.workItemId, result),
      })
    : null;

  let handle: ChatSessionHandle;
  try {
    handle = await startCodexSession({
      command,
      cwd: opts.cwd,
      env: opts.env,
      resumeThreadId: opts.resumeThreadId,
      selection: opts.selection,
      permissionMode: opts.permissionMode,
      chordMcp: toolAccess ? chordCodexMcpServer(toolAccess) : undefined,
      onEvent: (event) => {
        recordSessionTelemetry(sessionId, event);
        recordProviderUsage(opts.providerId, event);
        bridgeSDKEvent(bridge, opts.workItemId, event);
      },
      onThreadId: opts.onThreadId,
      onStderr: (text) =>
        log.debug('codex app-server: stderr', { sessionId, text: text.slice(0, 500) }),
      onExit: (code) => {
        log.info('codex app-server: session exited', { sessionId, code });
        toolAccess?.dispose();
        bridge.stopWatching();
        bridge.handleExit(opts.workItemId, code);
        opts.onExit(code);
      },
    });
  } catch (e) {
    toolAccess?.dispose();
    bridge.stopWatching();
    throw e;
  }

  if (opts.initialPrompt) handle.sendMessage(opts.initialPrompt);
  log.info('codex app-server: started session', { sessionId, resumed: !!opts.resumeThreadId });
  return { bridge, handle };
}
