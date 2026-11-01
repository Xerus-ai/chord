import { defineEvent } from '@shared/ipc/events';

/**
 * A session's permission mode changed on the main side — the agent switched
 * itself (Claude leaving plan after an approved plan, an ACP
 * `current_mode_update`) or an approved plan returned it to its earlier mode.
 * Topic: the session id. `mode` null = the agent's default.
 */
export interface PermissionModeUpdate {
  sessionId: string;
  mode: string | null;
}

export const permissionModeChannel = defineEvent<PermissionModeUpdate>('agent:permission-mode');
