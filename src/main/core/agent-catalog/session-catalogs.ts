import type { AgentControlCatalog } from '@shared/agent-control-catalog';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { agentCatalogChannel } from '@shared/events/agentCatalogEvents';
import { events } from '@main/lib/events';

/**
 * Catalogs reported by live sessions (ACP agents answer `session/new` with
 * their models and modes). Each session keeps its own; the latest per
 * provider serves the composer before that provider's next session exists.
 * In memory: a new session reports afresh.
 */
const bySession = new Map<string, AgentControlCatalog>();
const latestByProvider = new Map<AgentProviderId, AgentControlCatalog>();

export function publishSessionCatalog(sessionId: string, catalog: AgentControlCatalog): void {
  bySession.set(sessionId, catalog);
  latestByProvider.set(catalog.providerId, catalog);
  events.emit(
    agentCatalogChannel,
    { providerId: catalog.providerId, sessionId },
    catalog.providerId
  );
}

export function getSessionCatalog(sessionId: string): AgentControlCatalog | undefined {
  return bySession.get(sessionId);
}

export function getLatestProviderCatalog(
  providerId: AgentProviderId
): AgentControlCatalog | undefined {
  return latestByProvider.get(providerId);
}

export function forgetSessionCatalog(sessionId: string): void {
  bySession.delete(sessionId);
}
