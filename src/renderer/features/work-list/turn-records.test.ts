import { describe, expect, it } from 'vitest';
import type { ChatMessageEvent } from '@shared/events/chatEvents';
import { chatEventToTurn, timelineRowToTurn } from './turn-records';

describe('a turn record carries its history ref', () => {
  it('from the timeline', () => {
    const turn = timelineRowToTurn('wi-1', {
      turnId: 'turn-1',
      agentName: 'Claude',
      items: [],
      timestamp: 100,
      status: 'complete',
      sessionId: 'sess-1',
      historyRef: 'uuid-last-entry',
    });
    expect(turn.historyRef).toBe('uuid-last-entry');
  });

  it("from the owner's live agent_turn event", () => {
    const event: ChatMessageEvent = {
      id: 'row-1',
      workItemId: 'wi-1',
      sessionId: 'sess-1',
      senderType: 'agent',
      senderId: null,
      senderName: 'Claude',
      content: '',
      messageType: 'agent_turn',
      metadata: JSON.stringify({ turnId: 'turn-1', items: [] }),
      createdAt: 100,
      createdAtMs: 100_000,
      historyRef: 'uuid-last-entry',
    };
    expect(chatEventToTurn('wi-1', event)?.historyRef).toBe('uuid-last-entry');
  });

  it('is absent where the turn has none (an ACP turn, or a teammate’s copy)', () => {
    const turn = timelineRowToTurn('wi-1', {
      turnId: 'turn-1',
      agentName: 'Qwen',
      items: [],
      timestamp: 100,
      status: 'complete',
    });
    expect(turn.historyRef).toBeUndefined();
  });
});
