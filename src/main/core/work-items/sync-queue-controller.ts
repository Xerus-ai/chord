import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { gitStateCaptureService } from './git-state-capture';
import { syncQueueHealth } from './sync-queue-health';
import { syncQueueService } from './sync-queue-service';

/**
 * Surfaces permanently-failed cloud sync operations, queue health, and the
 * retry action. Error detail stays in the main-process logs; this exists so
 * the renderer badge and the protocol probe can assert on sync state
 * programmatically.
 */
export const syncQueueController = createRPCController({
  getFailedOperations: async () => {
    return ok({ operations: syncQueueService.getFailedOperations() });
  },

  /**
   * Queue depth + last-successful-drain heartbeat (NEW-6 recovery
   * surfacing): lets the renderer render "N operations queued since <date>"
   * when the queue is deep and stale instead of silently frozen.
   */
  getQueueHealth: async () => {
    return ok(await syncQueueHealth.getHealth());
  },

  retryAll: async () => {
    return ok({ retried: syncQueueService.retryAllFailed() });
  },

  /**
   * Called by the renderer after a successful share/revoke so git-state
   * capture starts (or stops) immediately instead of on the next shared-set
   * refresh. Sharing itself is a renderer → cloud call the main process
   * never sees.
   */
  kickGitStateCapture: async () => {
    gitStateCaptureService.kick();
    return ok();
  },
});
