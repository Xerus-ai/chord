import type { ChatMessageEvent } from '@shared/events/chatEvents';
import type { AgentTurn } from '@shared/stream-items';

/**
 * The two ways a finished turn reaches the work item's turn store
 * (`useTurnStreamCore`): a row of the canonical timeline (`getTimelineTurns`)
 * at mount, and an `agent_turn` chat message event afterwards.
 */

export interface TimelineTurnRow {
  turnId: string;
  agentName: string;
  items: unknown[];
  timestamp: number;
  status: 'complete' | 'streaming';
  startedAt?: number;
  completedAt?: number;
  usage?: AgentTurn['usage'];
  sessionId?: string;
  historyRef?: string;
}

export function timelineRowToTurn(workItemId: string, row: TimelineTurnRow): AgentTurn {
  return {
    id: row.turnId,
    workItemId,
    agentName: row.agentName,
    items: row.items as AgentTurn['items'],
    status: row.status,
    timestamp: row.timestamp,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    usage: row.usage,
    sessionId: row.sessionId,
    historyRef: row.historyRef,
  };
}

/**
 * The completed turn an `agent_turn` chat message carries, or null for any
 * other message or one without a turn. Throws on metadata that is not JSON.
 */
export function chatEventToTurn(workItemId: string, event: ChatMessageEvent): AgentTurn | null {
  if (event.messageType !== 'agent_turn') return null;
  const meta = JSON.parse(event.metadata ?? '{}');
  if (!meta.turnId || !meta.items) return null;
  return {
    id: meta.turnId,
    workItemId,
    agentName: event.senderName ?? 'Agent',
    items: meta.items,
    status: 'complete',
    timestamp: event.createdAt,
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    usage: meta.usage,
    sessionId: event.sessionId ?? undefined,
    historyRef: event.historyRef,
  };
}
