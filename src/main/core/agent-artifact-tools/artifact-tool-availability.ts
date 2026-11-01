import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { appSettingsService } from '@main/core/settings/settings-service';
import { CHORD_TOOLS_TERMINAL_CLIS } from './chord-cli-launch';

/**
 * Whether a chat session's agent can reach the chord tools on this transport
 * (`session-service.ts` `resolveTransport`): the Claude SDK takes the
 * in-process server, Codex's app-server and ACP agents the loopback endpoint
 * (P3), and a CLI in a PTY only when it has launch flags for an MCP server.
 */
function transportCarriesChordTools(providerId: AgentProviderId): boolean {
  if (providerId === 'claude') return true;
  const provider = getProvider(providerId);
  if (provider?.communication === 'app-server') return true;
  if (provider?.communication === 'acp' && provider.acpConfig) return true;
  return (CHORD_TOOLS_TERMINAL_CLIS as readonly string[]).includes(providerId);
}

/** Whether a new chat session for this provider starts with the chord `publish_artifact` tool. */
export async function isPublishToolAvailable(providerId: AgentProviderId): Promise<boolean> {
  if (!transportCarriesChordTools(providerId)) return false;
  const settings = await appSettingsService.get('artifacts');
  return settings.enabled;
}
