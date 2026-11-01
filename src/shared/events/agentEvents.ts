import { defineEvent } from '@shared/ipc/events';

export type AgentEventType = 'notification' | 'stop' | 'error';

export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog';

export const ATTENTION_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
]);

export function isAttentionNotification(nt: NotificationType | undefined): nt is NotificationType {
  return nt != null && ATTENTION_NOTIFICATION_TYPES.has(nt);
}

export interface AgentEvent {
  type: AgentEventType;
  source?: 'hook' | 'classifier';
  ptyId?: string;
  providerId?: string;
  workItemId?: string;
  projectId?: string;
  taskId?: string;
  conversationId?: string;
  /** The agent session this event belongs to. Every emit site resolves a real
      session before emitting, so this is never absent. */
  sessionId: string;
  /** The worktree `sessionId` runs in (its own, or the work item's primary if
      the session predates per-worktree binding). Resolved alongside
      `sessionId` — never absent. */
  worktreeId: string;
  timestamp: number;
  payload: {
    notificationType?: NotificationType;
    title?: string;
    message?: string;
    lastAssistantMessage?: string;
  };
}

export interface AgentEventEnvelope {
  event: AgentEvent;
  appFocused: boolean;
}

export type SoundEvent = 'needs_attention' | 'task_complete';

export const agentEventChannel = defineEvent<AgentEventEnvelope>('agent:event');

export interface AgentSessionExited {
  /** PTY session ID (= conversationId for agent sessions). */
  workItemId?: string;
  projectId?: string;
  sessionId: string;
  conversationId?: string;
  taskId?: string;
  exitCode: number | undefined;
}

/** Emitted when an agent PTY session exits. Topic = taskId. */
export const agentSessionExitedChannel = defineEvent<AgentSessionExited>('agent:session-exited');

/**
 * A work item's sessions changed: one started or ended, or a row was
 * created, renamed, marked done, removed or imported. Lists of a work item's
 * sessions (the sidebar's) re-read at once instead of at their next poll.
 * Topic = workItemId.
 */
export const agentSessionsChangedChannel = defineEvent<{ workItemId: string }>(
  'agent:sessions-changed'
);
