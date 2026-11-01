import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { createSDKMessageTranslator } from './sdk-message-translator';

/**
 * A turn's history ref is the uuid of its last main-chain transcript entry:
 * `forkSession(id, { upToMessageId })` slices the transcript there (Reset,
 * Fork). The SDK stream's `assistant` and `user` messages carry the same uuid
 * their transcript entry has (spike S1, `chord-lane-checks/probe-s1`).
 */

function sdk(msg: unknown): SDKMessage {
  return msg as SDKMessage;
}

function assistant(uuid: string, parentToolUseId: string | null = null): SDKMessage {
  return sdk({
    type: 'assistant',
    message: { id: `api-${uuid}`, role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
    parent_tool_use_id: parentToolUseId,
    session_id: 'sess',
    uuid,
  });
}

function toolResult(uuid: string, parentToolUseId: string | null = null): SDKMessage {
  return sdk({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'done' }],
    },
    parent_tool_use_id: parentToolUseId,
    tool_use_result: { content: [{ type: 'text', text: 'done' }] },
    session_id: 'sess',
    uuid,
  });
}

const SUCCESS = sdk({
  type: 'result',
  subtype: 'success',
  usage: { input_tokens: 10, output_tokens: 20 },
  total_cost_usd: 0.01,
  session_id: 'sess',
  uuid: 'uuid-result',
});

function completion(events: AgentOutputEvent[]) {
  return events.find(
    (e): e is Extract<AgentOutputEvent, { type: 'turn_completed' }> => e.type === 'turn_completed'
  );
}

describe('history ref on turn_completed', () => {
  it("is the uuid of the turn's last main-chain assistant message", () => {
    const translate = createSDKMessageTranslator();
    translate(assistant('e7a9ce59-a264-458c-8da4-60e07cf7d108'));
    translate(assistant('86de37d9-cf18-49b2-9243-cef21fa1ff24'));

    expect(completion(translate(SUCCESS))?.historyRef).toBe('86de37d9-cf18-49b2-9243-cef21fa1ff24');
  });

  it('is a main-chain tool result when that is the last entry', () => {
    const translate = createSDKMessageTranslator();
    translate(assistant('uuid-assistant'));
    translate(toolResult('uuid-tool-result'));

    expect(completion(translate(SUCCESS))?.historyRef).toBe('uuid-tool-result');
  });

  it("never moves to a subagent's entries, which live in the subagent's own transcript", () => {
    const translate = createSDKMessageTranslator();
    translate(assistant('uuid-main'));
    translate(assistant('uuid-sub-assistant', 'call_task'));
    translate(toolResult('uuid-sub-result', 'call_task'));

    expect(completion(translate(SUCCESS))?.historyRef).toBe('uuid-main');
  });

  it("follows each turn's own last entry", () => {
    const translate = createSDKMessageTranslator();
    translate(assistant('uuid-turn-1'));
    expect(completion(translate(SUCCESS))?.historyRef).toBe('uuid-turn-1');

    translate(assistant('uuid-turn-2'));
    expect(completion(translate(SUCCESS))?.historyRef).toBe('uuid-turn-2');
  });

  it('is absent when the conversation has no entry yet', () => {
    const translate = createSDKMessageTranslator();
    const done = completion(translate(SUCCESS));

    expect(done).toBeDefined();
    expect(done?.historyRef).toBeUndefined();
  });
});
