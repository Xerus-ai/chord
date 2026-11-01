import { createRPCController } from '@shared/ipc/rpc';
import { deviceSocketService } from '@main/core/commands/device-socket-service';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { log } from '@main/lib/logger';
import { capture, identify as telemetryIdentify } from '@main/lib/telemetry';
import { chordAccountService } from './services/chord-account-service';

export const accountController = createRPCController({
  // A failed credential-store read is not a signed-out user. Returning the
  // signed-out shape here made a transient failure indistinguishable from a
  // real sign-out and dropped authenticated users onto the sign-in screen.
  // The renderer gate treats a rejection as "unknown, retry".
  getSession: async () => {
    return await chordAccountService.getSession();
  },

  signIn: async () => {
    try {
      const result = await chordAccountService.signIn();
      telemetryIdentify(result.user.username, result.user.userId);
      capture('user_signed_in');

      void syncQueueService.reconcileLocalWorkItems();
      void syncQueueService.reconcileLocalArtifacts();
      void syncQueueService.reconcileLocalChatMessages();
      deviceSocketService.kick();

      return { success: true, user: result.user };
    } catch (error) {
      log.error('Account sign-in failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Sign-in failed',
      };
    }
  },

  signOut: async () => {
    try {
      await chordAccountService.signOut();
      capture('user_signed_out');
      return { success: true };
    } catch (error) {
      log.error('Account sign-out failed:', error);
      return { success: false, error: 'Sign-out failed' };
    }
  },

  checkHealth: async () => {
    try {
      return await chordAccountService.checkServerHealth();
    } catch {
      return false;
    }
  },

  validateSession: async () => {
    try {
      return await chordAccountService.validateSession();
    } catch {
      return false;
    }
  },

  getAccessToken: async () => {
    return await chordAccountService.getAccessToken();
  },

  // Switch the active workspace after accepting a team invite, then re-scope
  // realtime to the new org so presence and sync reconnect against it.
  setActiveOrg: async (orgId: string) => {
    try {
      await chordAccountService.setActiveOrg(orgId);
      deviceSocketService.kick();
      return { success: true };
    } catch (error) {
      log.error('Account setActiveOrg failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to switch workspace',
      };
    }
  },
});
