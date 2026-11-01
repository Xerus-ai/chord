import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import type { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';
import type { ClaudeProjectGate } from '@main/core/claude-sdk/claude-project-gate';
import type { ClaudeSDKSessionHandle } from '@main/core/claude-sdk/claude-sdk-session';
import { launchClaudeSDK } from '@main/core/claude-sdk/launch-claude-session';
import type { SessionLifecycleCallbacks } from './session-lifecycle-types';

export interface LaunchClaudeSDKOpts {
  workItemId: string;
  cwd: string;
  providerId: AgentProviderId;
  kind: 'chat' | 'terminal';
  initialPrompt?: string;
  model?: string;
  effort?: EffortLevel;
  fast: boolean;
  permissionMode?: PermissionMode;
  artifactTools: { preferredFormat: PreferredArtifactFormat } | null;
  projectGate: ClaudeProjectGate;
  isResuming?: boolean;
  externalSessionId?: string;
  previouslyStarted: boolean;
  resumableExternalId?: string;
  env: Record<string, string>;
  onSessionId: (externalSessionId: string) => void;
}

export interface LaunchClaudeSDKResult {
  bridge: AgentEventBridge;
  handle: ClaudeSDKSessionHandle;
  abortController: AbortController;
}

export async function launchClaudeSDKProcess(
  sessionId: string,
  opts: LaunchClaudeSDKOpts,
  callbacks: SessionLifecycleCallbacks
): Promise<LaunchClaudeSDKResult> {
  const { bridge, handle, abortController } = await launchClaudeSDK(sessionId, {
    workItemId: opts.workItemId,
    cwd: opts.cwd,
    providerId: opts.providerId,
    initialPrompt: opts.initialPrompt,
    model: opts.model,
    effort: opts.effort,
    fast: opts.fast,
    permissionMode: opts.permissionMode,
    artifactTools: opts.artifactTools,
    projectGate: opts.projectGate,
    isResuming: opts.isResuming ?? opts.previouslyStarted,
    resumeSessionId: opts.externalSessionId ?? opts.resumableExternalId,
    env: opts.env,
    onSessionId: opts.onSessionId,
    onExit: (code) => {
      // The turn is completed once, inside launchClaudeSDK's own onExit via
      // bridge.handleExit (shared with the ACP path). Completing it a second
      // time here persisted a duplicate turn plus a phantom "crashed" row.
      callbacks.onExit(code ?? undefined);
    },
  });

  return { bridge, handle, abortController };
}
