import { commandInboxService } from '@main/core/commands/command-inbox-service';
import { deviceSocketService } from '@main/core/commands/device-socket-service';
import { gitStateCaptureService } from '@main/core/work-items/git-state-capture';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { serverTraffic } from './server-traffic';

/**
 * Boot: starts every service that reaches the sync server on its own, after
 * holding server traffic, so none of them sends before the server has judged
 * this version; the desktop compatibility service's first reading releases it.
 */
export function startServerSenders(): void {
  serverTraffic.hold();
  syncQueueService.initialize();
  gitStateCaptureService.initialize();
  commandInboxService.initialize();
  deviceSocketService.initialize();
}

export function stopServerSenders(): void {
  deviceSocketService.dispose();
  commandInboxService.dispose();
  syncQueueService.dispose();
  gitStateCaptureService.dispose();
}
