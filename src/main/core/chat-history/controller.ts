import { createRPCController } from '@shared/ipc/rpc';
import { err } from '@shared/result';
import { log } from '@main/lib/logger';
import { forkToNewTab } from './fork-to-new-tab';
import { forkToNewWorktree } from './fork-to-new-worktree';
import { resetToTurn } from './reset-to-turn';

export const chatHistoryController = createRPCController({
  /** Reset to here: files back to after the turn, conversation forked at it. */
  resetToTurn: async (args: { workItemId: string; turnId: string }) => {
    try {
      return await resetToTurn(args);
    } catch (e) {
      log.error('chatHistoryCtrl.resetToTurn failed', { ...args, error: String(e) });
      return err({ type: 'reset_failed' as const, message: String(e) });
    }
  },

  /** Fork to new tab: a new chat on the same lane, its conversation forked at the turn. */
  forkToNewTab: async (args: { workItemId: string; turnId: string }) => {
    try {
      return await forkToNewTab(args);
    } catch (e) {
      log.error('chatHistoryCtrl.forkToNewTab failed', { ...args, error: String(e) });
      return err({ type: 'fork_failed' as const, message: String(e) });
    }
  },

  /** Fork to new worktree: a new lane from the turn's checkpoint, with a chat forked at the turn. */
  forkToNewWorktree: async (args: { workItemId: string; turnId: string }) => {
    try {
      return await forkToNewWorktree(args);
    } catch (e) {
      log.error('chatHistoryCtrl.forkToNewWorktree failed', { ...args, error: String(e) });
      return err({ type: 'fork_failed' as const, message: String(e) });
    }
  },
});
