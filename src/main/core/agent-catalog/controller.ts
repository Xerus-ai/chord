import type { AgentProviderId } from '@shared/agent-provider-registry';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { getAgentControlCatalog, refreshAgentControlCatalog } from './catalog-service';

export const agentCatalogController = createRPCController({
  get: async (args: { providerId: AgentProviderId; sessionId?: string }) => {
    try {
      return ok(await getAgentControlCatalog(args.providerId, args.sessionId));
    } catch (e) {
      return err({ type: 'probe_failed' as const, message: String(e) });
    }
  },
  refresh: async (args: { providerId: AgentProviderId; sessionId?: string }) => {
    try {
      return ok(await refreshAgentControlCatalog(args.providerId, args.sessionId));
    } catch (e) {
      return err({ type: 'probe_failed' as const, message: String(e) });
    }
  },
});
