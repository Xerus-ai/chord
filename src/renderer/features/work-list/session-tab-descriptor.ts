import { useLiveWorktreeStatus } from '@renderer/features/app-sidebar/live-worktree-status-store';
import {
  describeSessionTab,
  type SessionTabDescriptor,
  type SessionTabModel,
} from './session-tab-model';
import { useWorkItemWorktrees } from './use-work-item-worktrees';

/**
 * Header data for a session tab: label, provider (render its logo from
 * `agentConfig[providerId]` with `AgentLogo`), branch, and status dot.
 */
export function useSessionTabDescriptor(session: SessionTabModel): SessionTabDescriptor {
  const worktrees = useWorkItemWorktrees(session.workItemId);
  const { isSessionStreaming, hasPendingInput } = useLiveWorktreeStatus();
  return describeSessionTab(session, worktrees, {
    isStreaming: isSessionStreaming(session.id),
    hasPendingInput: hasPendingInput(session.id),
  });
}
