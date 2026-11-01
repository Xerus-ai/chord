import { createRPCController } from '@shared/ipc/rpc';
import { openRouterService } from './openrouter-service';
import { generateTeamPulse } from './team-pulse-generator';

export const openRouterController = createRPCController({
  saveKey: async (apiKey: string) => {
    if (!apiKey || typeof apiKey !== 'string') {
      return { success: false, error: 'An OpenRouter API key is required.' };
    }
    return openRouterService.saveKey(apiKey);
  },

  checkConnection: async () => openRouterService.checkConnection(),

  clearKey: async () => openRouterService.clearKey(),

  generateTeamPulse: async (args: { orgId: string; cloudApiBase: string }) => {
    return generateTeamPulse(args.orgId, args.cloudApiBase);
  },
});
