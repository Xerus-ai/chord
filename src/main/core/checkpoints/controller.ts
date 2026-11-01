import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { log } from '@main/lib/logger';
import { listCheckpoints, revertToCheckpoint } from './checkpoint-service';

export const checkpointsController = createRPCController({
  list: async (workItemId: string, worktreeId?: string) => {
    try {
      return ok({ checkpoints: listCheckpoints(workItemId, { worktreeId }) });
    } catch (e) {
      log.error('checkpointsCtrl.list failed', { workItemId, worktreeId, error: String(e) });
      return err({ type: 'checkpoint_error' as const, message: String(e) });
    }
  },

  revert: async (args: { workItemId: string; checkpointId: string }) => {
    try {
      const { safetyCheckpointId } = await revertToCheckpoint(args.workItemId, args.checkpointId);
      return ok({ safetyCheckpointId });
    } catch (e) {
      log.error('checkpointsCtrl.revert failed', { ...args, error: String(e) });
      return err({ type: 'checkpoint_error' as const, message: String(e) });
    }
  },
});
