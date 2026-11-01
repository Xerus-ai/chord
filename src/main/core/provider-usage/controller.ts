import type { AgentProviderId } from '@shared/agent-provider-registry';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { getProviderUsage } from './provider-usage-store';
import { refreshProviderUsage } from './refresh-provider-usage';

export const providerUsageController = createRPCController({
  get: async (args: { providerId: AgentProviderId }) => ok(getProviderUsage(args.providerId)),
  /** Reads the windows again when the last report is stale and the provider can be asked. */
  refresh: async (args: { providerId: AgentProviderId }) => {
    try {
      return ok(await refreshProviderUsage(args.providerId));
    } catch (e) {
      return err({ type: 'read_failed' as const, message: String(e) });
    }
  },
});
