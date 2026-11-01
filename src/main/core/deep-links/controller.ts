import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { deepLinkRouter } from './open-protocol-url';

export const deepLinksController = createRPCController({
  /**
   * The renderer subscribes to `deepLinkOpenChannel`, then calls this once:
   * it gets the links that arrived before it was listening, and later ones
   * arrive on the channel.
   */
  claimPending: () => ok({ targets: deepLinkRouter.claimPending() }),
});
