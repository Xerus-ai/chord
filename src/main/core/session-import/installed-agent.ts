import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';

/**
 * Whether the binary a session source runs for `providerId` — Codex's CLI, an
 * ACP agent's bridge — is on this machine. Listing never runs an agent that is
 * not installed (no `npx` download just to look for sessions).
 */
export async function isAgentInstalled(providerId: AgentProviderId): Promise<boolean> {
  const provider = getProvider(providerId);
  const acp = provider?.acpConfig;
  const binary = acp ? (acp.usesNpx ? null : acp.bridge) : provider?.cli;
  if (!binary) return false;
  return (await resolveCommandPath(binary, new LocalExecutionContext())) !== null;
}
