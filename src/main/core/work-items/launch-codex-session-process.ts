import type { CatalogSelection } from '@shared/agent-control-catalog';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import type { ChatSessionHandle } from '@main/core/agent-sessions/chat-handle';
import type { ChatPermissionMode } from '@main/core/agent-sessions/permission-mode-store';
import type { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';
import { launchCodexSession } from '@main/core/codex-app-server/launch-codex-session';
import type { SessionLifecycleCallbacks } from './session-lifecycle-types';

export interface LaunchCodexOpts {
  workItemId: string;
  cwd: string;
  providerId: AgentProviderId;
  initialPrompt?: string;
  /** The row's persisted thread id; a fresh thread starts without one. */
  externalSessionId?: string;
  launch: CatalogSelection;
  permissionMode: () => ChatPermissionMode;
  artifactTools: { preferredFormat: PreferredArtifactFormat } | null;
  env: Record<string, string>;
  onSessionId: (externalSessionId: string) => void;
}

export async function launchCodexProcess(
  sessionId: string,
  opts: LaunchCodexOpts,
  callbacks: SessionLifecycleCallbacks
): Promise<{ bridge: AgentEventBridge; handle: ChatSessionHandle }> {
  return launchCodexSession(sessionId, {
    workItemId: opts.workItemId,
    cwd: opts.cwd,
    providerId: opts.providerId,
    initialPrompt: opts.initialPrompt,
    resumeThreadId: opts.externalSessionId,
    selection: opts.launch,
    permissionMode: opts.permissionMode,
    artifactTools: opts.artifactTools,
    env: opts.env,
    onThreadId: opts.onSessionId,
    onExit: (code) => callbacks.onExit(code ?? undefined),
  });
}
