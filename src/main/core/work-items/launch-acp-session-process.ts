import type { AgentControlCatalog, CatalogSelection } from '@shared/agent-control-catalog';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import { removeAcpConnection } from '@main/core/acp/acp-session-store';
import { launchAcpSession } from '@main/core/acp/launch-acp-session';
import type { ChatPermissionMode } from '@main/core/agent-sessions/permission-mode-store';
import { recordLaunchedModel } from '@main/core/agent-sessions/session-launch-model';
import type { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';
import type { SessionLifecycleCallbacks } from './session-lifecycle-types';

export interface LaunchAcpOpts {
  workItemId: string;
  cwd: string;
  providerId: AgentProviderId;
  kind: 'chat' | 'terminal';
  initialPrompt?: string;
  /** The agent's own session to continue; see `launchAcpSession`. */
  externalSessionId?: string;
  /** The session's stored model/effort pick, narrowed to a catalog. */
  resolveSelection: (catalog: AgentControlCatalog) => CatalogSelection;
  permissionMode: ChatPermissionMode;
  artifactTools: { preferredFormat: PreferredArtifactFormat } | null;
  env: Record<string, string>;
}

export interface LaunchAcpResult {
  bridge: AgentEventBridge;
  externalSessionId?: string;
  launch: CatalogSelection;
}

export async function launchAcpProcess(
  sessionId: string,
  opts: LaunchAcpOpts,
  callbacks: SessionLifecycleCallbacks
): Promise<LaunchAcpResult> {
  const { bridge, externalSessionId, launch } = await launchAcpSession(sessionId, {
    workItemId: opts.workItemId,
    cwd: opts.cwd,
    providerId: opts.providerId,
    initialPrompt: opts.initialPrompt,
    resumeSessionId: opts.externalSessionId,
    resolveSelection: opts.resolveSelection,
    permissionMode: opts.permissionMode,
    artifactTools: opts.artifactTools,
    env: opts.env,
    onExit: () => {
      removeAcpConnection(sessionId);
      callbacks.onExit(undefined);
    },
  });

  // The agent's own catalog can narrow the pick differently from the launch
  // resolution; the row records what the session really runs.
  recordLaunchedModel(sessionId, launch.model);
  return { bridge, externalSessionId, launch };
}
