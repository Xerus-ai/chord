import type { AgentProviderId } from '@shared/agent-provider-registry';
import { pickPermissionMode } from '@shared/permission-modes';
import { appSettingsService } from '@main/core/settings/settings-service';
import {
  getChatPermissionMode,
  setChatPermissionMode,
  type ChatPermissionMode,
} from './permission-mode-store';

/** A pick (null = none) with the agent's saved default (Settings › Agents & models) filled in. */
export async function withSavedDefaultMode(
  mode: ChatPermissionMode,
  providerId: AgentProviderId
): Promise<ChatPermissionMode> {
  return pickPermissionMode(
    mode,
    await appSettingsService.get('agentDefaultPermissionModes'),
    providerId
  );
}

/**
 * A chat session that starts with no mode picked starts in the agent's saved
 * default, recorded as the session's own pick — so it keeps that mode for its
 * life, and a later change to the setting applies to new sessions only.
 */
export async function seedDefaultPermissionMode(
  workItemId: string,
  sessionId: string,
  providerId: AgentProviderId
): Promise<void> {
  if (getChatPermissionMode(workItemId, sessionId) !== null) return;
  const saved = await withSavedDefaultMode(null, providerId);
  if (saved !== null) setChatPermissionMode(workItemId, saved, sessionId);
}
