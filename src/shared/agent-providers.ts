import {
  AGENT_PROVIDER_IDS,
  resolveInstallCommand,
  type AgentProviderDefinition,
  type AgentProviderId,
} from './agent-provider-registry';
import { CHAT_AGENT_PROVIDERS } from './agent-providers-chat';
import { TERMINAL_AGENT_PROVIDERS } from './agent-providers-terminal';

const PROVIDER_MAP = new Map<AgentProviderId, AgentProviderDefinition>();
for (const provider of [...CHAT_AGENT_PROVIDERS, ...TERMINAL_AGENT_PROVIDERS]) {
  if (PROVIDER_MAP.has(provider.id))
    throw new Error(`Agent provider ${provider.id} is defined twice`);
  PROVIDER_MAP.set(provider.id, provider);
}

/** Every agent's definition, in `AGENT_PROVIDER_IDS` order: the order agent lists show. */
export const AGENT_PROVIDERS: AgentProviderDefinition[] = AGENT_PROVIDER_IDS.map((id) => {
  const provider = PROVIDER_MAP.get(id);
  if (!provider) throw new Error(`Agent provider ${id} has no definition`);
  return provider;
});

export function getProvider(id: AgentProviderId): AgentProviderDefinition | undefined {
  return PROVIDER_MAP.get(id);
}

export function getInstallCommandForProvider(
  id: AgentProviderId,
  platform: NodeJS.Platform
): string | null {
  const provider = PROVIDER_MAP.get(id);
  return provider ? resolveInstallCommand(provider, platform) : null;
}

export function getDescriptionForProvider(id: AgentProviderId): string | null {
  return PROVIDER_MAP.get(id)?.description ?? null;
}

export function getDocUrlForProvider(id: AgentProviderId): string | null {
  return PROVIDER_MAP.get(id)?.docUrl ?? null;
}

export function listDetectableProviders(): AgentProviderDefinition[] {
  return AGENT_PROVIDERS.filter(
    (provider) => provider.detectable !== false && provider.commands?.length
  );
}
