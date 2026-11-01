import { defineEvent } from '@shared/ipc/events';
import type { AgentProviderId } from '../agent-provider-registry';

/**
 * A live session reported a new catalog (its agent's models, efforts, modes).
 * Topic: the provider id — the provider's cached catalog changed with it.
 */
export interface AgentCatalogUpdate {
  providerId: AgentProviderId;
  sessionId: string;
}

export const agentCatalogChannel = defineEvent<AgentCatalogUpdate>('agent:catalog');
