import { permissionModeChannel } from '@shared/events/permissionModeEvents';
import { events } from '@main/lib/events';
import { setChatPermissionMode, type ChatPermissionMode } from './permission-mode-store';
import { scheduleSessionCloudSync } from './session-cloud-sync';

/**
 * Records a session's mode that changed without the composer asking — the
 * agent switched itself, or an approved plan moved it — and tells that
 * session's composer, so the mode menu shows what the agent is really in, and
 * republishes the chat for a teammate's composer.
 */
export function reportPermissionMode(
  workItemId: string,
  sessionId: string,
  mode: ChatPermissionMode
): void {
  setChatPermissionMode(workItemId, mode, sessionId);
  events.emit(permissionModeChannel, { sessionId, mode }, sessionId);
  scheduleSessionCloudSync(workItemId);
}
