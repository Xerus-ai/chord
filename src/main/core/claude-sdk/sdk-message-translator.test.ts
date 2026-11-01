import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { createSDKMessageTranslator } from './sdk-message-translator';

function sdk(msg: unknown): SDKMessage {
  return msg as SDKMessage;
}

function messageStart(apiMessageId: string): SDKMessage {
  return sdk({
    type: 'stream_event',
    event: { type: 'message_start', message: { id: apiMessageId } },
    parent_tool_use_id: null,
    session_id: 'sess',
    uuid: 'uuid-start',
  });
}

function textDelta(text: string): SDKMessage {
  return sdk({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    parent_tool_use_id: null,
    session_id: 'sess',
    uuid: 'uuid-delta',
  });
}

function thinkingDelta(thinking: string): SDKMessage {
  return sdk({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking },
    },
    parent_tool_use_id: null,
    session_id: 'sess',
    uuid: 'uuid-think',
  });
}

function assistantMessage(
  apiMessageId: string,
  content: Array<Record<string, unknown>>
): SDKMessage {
  return sdk({
    type: 'assistant',
    message: { id: apiMessageId, role: 'assistant', content },
    parent_tool_use_id: null,
    session_id: 'sess',
    uuid: `uuid-${apiMessageId}`,
  });
}

function textOf(events: AgentOutputEvent[]): string {
  return events
    .filter((e): e is Extract<AgentOutputEvent, { type: 'text' }> => e.type === 'text')
    .map((e) => e.text)
    .join('');
}

function reasoningOf(events: AgentOutputEvent[]): string {
  return events
    .filter((e): e is Extract<AgentOutputEvent, { type: 'reasoning' }> => e.type === 'reasoning')
    .map((e) => e.text)
    .join('');
}

describe('createSDKMessageTranslator', () => {
  it('does not re-emit text already streamed via deltas when the final assistant message arrives', () => {
    const translate = createSDKMessageTranslator();
    const all: AgentOutputEvent[] = [];

    all.push(...translate(messageStart('msg_1')));
    all.push(...translate(textDelta('Hello ')));
    all.push(...translate(textDelta('world')));
    all.push(...translate(assistantMessage('msg_1', [{ type: 'text', text: 'Hello world' }])));

    expect(textOf(all)).toBe('Hello world');
  });

  it('does not re-emit thinking already streamed via deltas', () => {
    const translate = createSDKMessageTranslator();
    const all: AgentOutputEvent[] = [];

    all.push(...translate(messageStart('msg_1')));
    all.push(...translate(thinkingDelta('pondering')));
    all.push(
      ...translate(assistantMessage('msg_1', [{ type: 'thinking', thinking: 'pondering' }]))
    );

    expect(reasoningOf(all)).toBe('pondering');
  });

  it('emits full text for an assistant message that had no streamed deltas', () => {
    const translate = createSDKMessageTranslator();
    const events = translate(assistantMessage('msg_1', [{ type: 'text', text: 'No partials' }]));
    expect(textOf(events)).toBe('No partials');
  });

  it('emits only the unstreamed suffix when the final message extends the deltas', () => {
    const translate = createSDKMessageTranslator();
    const all: AgentOutputEvent[] = [];

    all.push(...translate(messageStart('msg_1')));
    all.push(...translate(textDelta('Hello')));
    all.push(...translate(assistantMessage('msg_1', [{ type: 'text', text: 'Hello world' }])));

    expect(textOf(all)).toBe('Hello world');
  });

  it('ignores a duplicate final assistant message for the same api message id', () => {
    const translate = createSDKMessageTranslator();
    const first = translate(assistantMessage('msg_1', [{ type: 'text', text: 'Once' }]));
    const second = translate(assistantMessage('msg_1', [{ type: 'text', text: 'Once' }]));

    expect(textOf(first)).toBe('Once');
    expect(second).toEqual([]);
  });

  it('tracks messages independently across turns', () => {
    const translate = createSDKMessageTranslator();
    const all: AgentOutputEvent[] = [];

    all.push(...translate(messageStart('msg_1')));
    all.push(...translate(textDelta('First.')));
    all.push(...translate(assistantMessage('msg_1', [{ type: 'text', text: 'First.' }])));

    all.push(...translate(messageStart('msg_2')));
    all.push(...translate(textDelta('Second.')));
    all.push(...translate(assistantMessage('msg_2', [{ type: 'text', text: 'Second.' }])));

    expect(textOf(all)).toBe('First.Second.');
  });

  it('still emits tool_use blocks from a fully streamed assistant message', () => {
    const translate = createSDKMessageTranslator();
    const all: AgentOutputEvent[] = [];

    all.push(...translate(messageStart('msg_1')));
    all.push(...translate(textDelta('Running a tool')));
    const finals = translate(
      assistantMessage('msg_1', [
        { type: 'text', text: 'Running a tool' },
        { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } },
      ])
    );
    all.push(...finals);

    expect(textOf(all)).toBe('Running a tool');
    const toolCalls = finals.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ callId: 'call_1', name: 'Bash' });
  });

  it('translates a success result into usage and turn_completed', () => {
    const translate = createSDKMessageTranslator();
    const events = translate(
      sdk({
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 10, output_tokens: 20 },
        total_cost_usd: 0.01,
        session_id: 'sess',
        uuid: 'uuid-result',
      })
    );

    expect(events.map((e) => e.type)).toEqual(['usage', 'turn_completed']);
  });

  it('translates a rate_limit_event into its usage windows', () => {
    // Shape captured from Claude Code 2.1.280 — `unifiedWindows` is on the
    // wire though the SDK types omit it.
    const translate = createSDKMessageTranslator();
    const events = translate(
      sdk({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          resetsAt: 1790104200,
          rateLimitType: 'five_hour',
          unifiedWindows: {
            five_hour: { utilization: 0.38, resetsAt: 1790104200 },
            seven_day: { utilization: 0.42, resetsAt: 1790244000 },
          },
        },
        session_id: 'sess',
        uuid: 'uuid-rate',
      })
    );

    expect(events).toEqual([
      {
        type: 'rate_limit',
        windows: [
          { id: 'five_hour', label: '5-hour limit', usedPercent: 38, resetsAt: 1790104200000 },
          { id: 'seven_day', label: 'Weekly limit', usedPercent: 42, resetsAt: 1790244000000 },
        ],
      },
    ]);
  });

  it('completes a main-agent tool call from its tool result (parent_tool_use_id null)', () => {
    // Main-agent tool results carry parent_tool_use_id null; the call they
    // answer is identified by the tool_result block's tool_use_id.
    const translate = createSDKMessageTranslator();
    const events = translate(
      sdk({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_main', content: 'done' }],
        },
        parent_tool_use_id: null,
        tool_use_result: { content: [{ type: 'text', text: 'done' }] },
        session_id: 'sess',
        uuid: 'uuid-tool-result',
      })
    );

    const updates = events.filter(
      (e): e is Extract<AgentOutputEvent, { type: 'tool_call_update' }> =>
        e.type === 'tool_call_update'
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ callId: 'call_main', status: 'completed' });
  });

  it('emits a plan event from a main-agent ExitPlanMode result', () => {
    const translate = createSDKMessageTranslator();
    const events = translate(
      sdk({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_exit_plan', content: 'ok' }],
        },
        parent_tool_use_id: null,
        tool_use_result: { plan: '1. Add tests\n2. Implement feature\n3. Verify' },
        session_id: 'sess',
        uuid: 'uuid-plan-result',
      })
    );

    const plans = events.filter(
      (e): e is Extract<AgentOutputEvent, { type: 'plan' }> => e.type === 'plan'
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].entries.map((entry) => entry.text)).toEqual([
      'Add tests',
      'Implement feature',
      'Verify',
    ]);
  });

  it('emits tool_use from per-block assistant messages sharing one api message id', () => {
    // The SDK delivers one assistant message per content block: a thinking
    // block and a tool_use block of the same API message arrive as two
    // assistant messages with the same message.id but distinct uuids.
    // Deduping by API message id drops the tool call entirely.
    const translate = createSDKMessageTranslator();
    translate(messageStart('msg_shared'));
    translate(thinkingDelta('pondering'));

    const thinkingMsg = sdk({
      type: 'assistant',
      message: {
        id: 'msg_shared',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'pondering' }],
      },
      parent_tool_use_id: null,
      session_id: 'sess',
      uuid: 'uuid-block-1',
    });
    translate(thinkingMsg);

    const toolMsg = sdk({
      type: 'assistant',
      message: {
        id: 'msg_shared',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_w', name: 'Write', input: { file_path: 'x.md' } }],
      },
      parent_tool_use_id: null,
      session_id: 'sess',
      uuid: 'uuid-block-2',
    });
    const events = translate(toolMsg);

    const toolCalls = events.filter(
      (e): e is Extract<AgentOutputEvent, { type: 'tool_call' }> => e.type === 'tool_call'
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ callId: 'call_w', name: 'Write' });

    // A true replay of the same SDK message (same uuid) is still ignored.
    expect(translate(toolMsg)).toEqual([]);
  });

  it('still routes subagent tool results to the parent task call', () => {
    const translate = createSDKMessageTranslator();
    const events = translate(
      sdk({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'inner_call', content: 'ok' }],
        },
        parent_tool_use_id: 'task_1',
        tool_use_result: { content: [{ type: 'text', text: 'ok' }] },
        session_id: 'sess',
        uuid: 'uuid-sub-result',
      })
    );

    const updates = events.filter(
      (e): e is Extract<AgentOutputEvent, { type: 'tool_call_update' }> =>
        e.type === 'tool_call_update'
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ callId: 'task_1' });
  });
});
