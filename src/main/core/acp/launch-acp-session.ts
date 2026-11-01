import type { AgentControlCatalog, CatalogSelection } from '@shared/agent-control-catalog';
import { getAgentDisplayName } from '@shared/agent-display-name';
import { buildModelArgs } from '@shared/agent-models';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import { mapAcpUsageUpdate } from '@main/core/acp/acp-adapter';
import { AcpLiveControls } from '@main/core/acp/acp-live-controls';
import { AcpSDKClient } from '@main/core/acp/acp-sdk-client';
import { removeAcpConnection, setAcpConnection } from '@main/core/acp/acp-session-store';
import { resolveAcpBridge } from '@main/core/acp/resolve-acp-bridge';
import {
  chordAcpMcpServer,
  openChordMcpAccess,
} from '@main/core/agent-artifact-tools/chord-mcp-access';
import { getAgentControlCatalog } from '@main/core/agent-catalog/catalog-service';
import type { ChatPermissionMode } from '@main/core/agent-sessions/permission-mode-store';
import { reportPermissionMode } from '@main/core/agent-sessions/report-permission-mode';
import { recordSessionTelemetry } from '@main/core/agent-sessions/session-telemetry';
import { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';
import { log } from '@main/lib/logger';

export interface AcpLaunchResult {
  bridge: AgentEventBridge;
  connection: AcpSDKClient;
  externalSessionId: string;
  /** The selection the session runs, resolved against its own catalog. */
  launch: CatalogSelection;
}

export async function launchAcpSession(
  sessionId: string,
  opts: {
    workItemId: string;
    cwd: string;
    providerId: AgentProviderId;
    initialPrompt?: string;
    /** The agent's own session to continue (an imported or earlier one); a new one without it. */
    resumeSessionId?: string;
    /** The session's stored model/effort pick, narrowed to a catalog. */
    resolveSelection: (catalog: AgentControlCatalog) => CatalogSelection;
    permissionMode: ChatPermissionMode;
    /** Settings › Agents › Artifacts at launch; null while "Let agents create artifacts" is off. */
    artifactTools: { preferredFormat: PreferredArtifactFormat } | null;
    /** The lane environment the agent process runs with. */
    env: Record<string, string>;
    onExit: (code: number | null) => void;
  }
): Promise<AcpLaunchResult> {
  const providerDef = getProvider(opts.providerId);
  const acpConfig = providerDef?.acpConfig;
  if (!acpConfig) throw new Error(`No ACP config for provider ${opts.providerId}`);

  const { command, args } = await resolveAcpBridge(acpConfig);
  // Until this provider's agent has reported a catalog, the selection can only
  // ride on the bridge's argv, from the static table of verified flags
  // (codex-acp parses codex's `-c key=value`; copilot's bridge is the copilot
  // CLI). Once a session has reported, picks are set on the session instead.
  const launchCatalog = await getAgentControlCatalog(opts.providerId, sessionId);
  if (launchCatalog.source === 'static') {
    args.push(...buildModelArgs(opts.providerId, opts.resolveSelection(launchCatalog)));
  }

  const bridge = new AgentEventBridge(getAgentDisplayName(opts.providerId));
  bridge.setSessionId(sessionId);
  bridge.startWatching(opts.workItemId, opts.cwd);

  // The agent is its own process, so it reaches the chord tools over the
  // loopback endpoint with this session's token (plan 2026-09-23 P3).
  const toolAccess = opts.artifactTools
    ? await openChordMcpAccess({
        sessionId,
        workItemId: opts.workItemId,
        cwd: opts.cwd,
        preferredFormat: opts.artifactTools.preferredFormat,
        onPublished: (result) => bridge.recordPublishedArtifact(opts.workItemId, result),
      })
    : null;

  let controls: AcpLiveControls | null = null;
  const connection = new AcpSDKClient({
    command,
    args,
    cwd: opts.cwd,
    env: opts.env,
    mcpServers: (transport) => {
      if (!toolAccess) return [];
      log.info('acp: chord tools', { sessionId, transport: transport.http ? 'http' : 'stdio' });
      return [chordAcpMcpServer(toolAccess, transport)];
    },
    onSessionUpdate: (update) => {
      switch (update.sessionUpdate) {
        // Telemetry only: the bridge keeps no ACP usage, and handing it this
        // update would reopen a turn it has already completed.
        case 'usage_update':
          for (const event of mapAcpUsageUpdate(update)) recordSessionTelemetry(sessionId, event);
          return;
        // Before `session/new` returns there are no controls yet; its reply
        // carries the same state.
        case 'config_option_update':
        case 'current_mode_update':
          controls?.handleUpdate(update);
          return;
        default:
          bridge.handleAcpUpdate(opts.workItemId, update);
      }
    },
    onPermissionRequest: (request) => bridge.handlePermission(opts.workItemId, request),
    onFileWrite: (filePath) => bridge.handleFileWrite(filePath),
    onError: (e) => bridge.handleError(opts.workItemId, e),
    onExit: (code) => {
      log.info('acp: session exited', { sessionId, code });
      toolAccess?.dispose();
      bridge.stopWatching();
      bridge.handleExit(opts.workItemId, code);
      opts.onExit(code);
    },
  });

  let started: Awaited<ReturnType<AcpSDKClient['start']>>;
  try {
    started = await connection.start(opts.resumeSessionId);
  } catch (e) {
    toolAccess?.dispose();
    throw e;
  }
  controls = new AcpLiveControls(
    sessionId,
    opts.providerId,
    started.controls,
    (method, params) => connection.requestForSession(method, params),
    (modeId) => reportPermissionMode(opts.workItemId, sessionId, modeId)
  );
  setAcpConnection(sessionId, connection, controls);
  // A launch that fails from here registers no session, so no teardown would
  // ever stop the agent: it is forgotten and stopped before the launch rejects.
  let launch: CatalogSelection;
  try {
    launch = await controls.applySelection(opts.resolveSelection);
    await controls.applyPermissionMode(opts.permissionMode);
  } catch (e) {
    removeAcpConnection(sessionId);
    toolAccess?.dispose();
    await connection.abandon();
    throw e;
  }

  // Not awaited: the session must register as live while its first turn runs,
  // or a pick made meanwhile finds no session to apply to.
  if (opts.initialPrompt) {
    connection.sendPrompt(opts.initialPrompt).then(
      (usage) => {
        if (usage) bridge.recordUsage(usage);
        bridge.completeTurn(opts.workItemId);
      },
      (e: unknown) => {
        bridge.handleError(opts.workItemId, e instanceof Error ? e : new Error(String(e)));
        bridge.completeTurn(opts.workItemId);
      }
    );
  }

  log.info('acp: started session', { sessionId, providerId: opts.providerId });

  return { bridge, connection, externalSessionId: started.sessionId, launch };
}
