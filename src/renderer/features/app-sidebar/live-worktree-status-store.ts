import { create } from 'zustand';
import type { AgentEvent } from '@shared/events/agentEvents';
import type { TurnStreamEvent } from '@shared/stream-items';
import {
  applyAgentEvent,
  applyPendingInputSeed,
  applySeed,
  applyTurnStreamEvent,
  createInitialLiveWorktreeStatusState,
  type LiveSessionRef,
  type LiveWorktreeStatusState,
} from './live-worktree-status-reducer';

/**
 * Cross-cutting client state (T0.7): which agent sessions/worktrees/work items
 * are live right now, and which sessions are waiting on the user. One store
 * for the whole app so the sidebar and any tab descriptor read the same truth
 * without each mounting its own IPC subscription — only
 * `useSidebarSummaries` feeds events in; see its `handleAgentEvent`.
 */
interface LiveWorktreeStatusStore extends LiveWorktreeStatusState {
  applyAgentEvent: (
    event: Pick<AgentEvent, 'type' | 'workItemId' | 'sessionId' | 'worktreeId' | 'payload'>
  ) => void;
  applySeed: (rows: readonly LiveSessionRef[]) => void;
  applyPendingInputSeed: (rows: readonly LiveSessionRef[]) => void;
  applyTurnStreamEvent: (event: Pick<TurnStreamEvent, 'sessionId' | 'action'>) => void;
}

export const useLiveWorktreeStatusStore = create<LiveWorktreeStatusStore>()((set, get) => ({
  ...createInitialLiveWorktreeStatusState(),

  applyAgentEvent: (event) => {
    const next = applyAgentEvent(get(), event);
    if (next !== get()) set(next);
  },

  applySeed: (rows) => {
    const next = applySeed(get(), rows);
    if (next !== get()) set(next);
  },

  applyPendingInputSeed: (rows) => {
    const next = applyPendingInputSeed(get(), rows);
    if (next !== get()) set(next);
  },

  applyTurnStreamEvent: (event) => {
    const next = applyTurnStreamEvent(get(), event);
    if (next !== get()) set(next);
  },
}));

/**
 * Read-only view for consumers (sidebar rows, tab descriptors). Does not
 * subscribe to IPC itself — `useSidebarSummaries` owns the one subscription,
 * keyed by the caller's work-item-id set, and routes events into the store
 * above. Calling this from many places is safe and cheap: it's a plain
 * Zustand selector, not a new listener.
 */
export function useLiveWorktreeStatus() {
  const streamingSessionIds = useLiveWorktreeStatusStore((s) => s.streamingSessionIds);
  const streamingWorktreeIds = useLiveWorktreeStatusStore((s) => s.streamingWorktreeIds);
  const runningWorkItemIds = useLiveWorktreeStatusStore((s) => s.runningWorkItemIds);
  const pendingInputSessionIds = useLiveWorktreeStatusStore((s) => s.pendingInputSessionIds);

  return {
    runningWorkItemIds,
    isSessionStreaming: (sessionId: string) => streamingSessionIds.has(sessionId),
    isWorktreeStreaming: (worktreeId: string) => streamingWorktreeIds.has(worktreeId),
    hasPendingInput: (sessionId: string) => pendingInputSessionIds.has(sessionId),
  };
}
