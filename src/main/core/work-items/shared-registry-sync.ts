import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import { scheduleWorktreeCloudSync } from '@main/core/worktrees/worktree-cloud-sync';
import { gitStateCaptureService } from './git-state-capture';

/**
 * A work item that becomes shared pushes its chat-session and worktree
 * registries at once (devstation-9ld). Both are otherwise pushed only when a
 * chat or worktree changes while the item is shared, so an item shared after
 * its chats existed showed teammates none of them. Wired here rather than in
 * git-state-capture, which both sync modules already import. Returns the
 * unsubscribe.
 */
export function startSharedRegistrySync(): () => void {
  return gitStateCaptureService.onTargetsAdded((workItemIds) => {
    for (const workItemId of workItemIds) {
      scheduleSessionCloudSync(workItemId);
      scheduleWorktreeCloudSync(workItemId);
    }
  });
}
