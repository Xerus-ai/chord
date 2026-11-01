import { isValidProviderId } from './agent-provider-registry';
import { getProvider } from './agent-providers';

/** The name an agent's turns and messages are attributed to. */
export function getAgentDisplayName(providerId: string): string {
  if (!isValidProviderId(providerId)) {
    throw new Error(`Unknown agent provider: ${providerId}`);
  }
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown agent provider: ${providerId}`);
  return provider.name;
}

/**
 * The name shown on a persisted turn. The session's provider is the source of
 * truth — turns written before bridges carried the provider name were stored
 * as "Chord Agent". Turns without a known session keep what was stored.
 */
export function resolveTurnAgentName(args: {
  sessionProviderId: string | null | undefined;
  senderName: string | null | undefined;
}): string {
  if (isValidProviderId(args.sessionProviderId)) {
    return getAgentDisplayName(args.sessionProviderId);
  }
  return args.senderName ?? 'Agent';
}
