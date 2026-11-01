import { defineEvent } from '@shared/ipc/events';

export type ChatMessageType =
  | 'text'
  | 'reasoning'
  | 'tool_call'
  | 'permission'
  | 'plan'
  | 'file_change'
  | 'commit'
  | 'error';

export interface ChatMessageEvent {
  id: string;
  workItemId: string;
  /** The local agent_sessions.id that produced this message, or null. */
  sessionId: string | null;
  senderType: string;
  senderId: string | null;
  senderName: string | null;
  content: string;
  messageType: string;
  metadata: string;
  /** Epoch seconds. */
  createdAt: number;
  /** The same moment to the millisecond: what a chat is ordered by. */
  createdAtMs: number;
  /** An `agent_turn`'s history ref (`AgentTurn.historyRef`); local, never synced. */
  historyRef?: string;
}

export const chatMessageChannel = defineEvent<ChatMessageEvent>('chat:message');
