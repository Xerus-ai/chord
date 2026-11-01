import { describe, expect, it } from 'vitest';
import { convertSessionUpdate, mapAcpPromptUsage, mapAcpUsageUpdate } from './acp-adapter';
import { CLAUDE_PROMPT_REPLY, OPENCODE_PROMPT_REPLY } from './acp-captured-replies';

// Real `usage_update` notifications, captured 2026-09-23: opencode reports
// cost on every update; claude-agent-acp only on the turn's last one.
const OPENCODE_USAGE = {
  sessionUpdate: 'usage_update' as const,
  used: 19850,
  size: 200000,
  cost: { amount: 0, currency: 'USD' },
};
const CLAUDE_USAGE_MID_TURN = {
  sessionUpdate: 'usage_update' as const,
  used: 21290,
  size: 1000000,
};
const CLAUDE_USAGE_END_OF_TURN = {
  sessionUpdate: 'usage_update' as const,
  used: 21293,
  size: 1000000,
  cost: { amount: 0.42596, currency: 'USD' },
};

describe('mapAcpUsageUpdate', () => {
  it('reports context fill from used/size and the session cost in USD', () => {
    expect(mapAcpUsageUpdate(OPENCODE_USAGE)).toEqual([
      { type: 'context_usage', usedTokens: 19850, maxTokens: 200000 },
      { type: 'usage', totalCostUsd: 0 },
    ]);
    expect(mapAcpUsageUpdate(CLAUDE_USAGE_END_OF_TURN)).toEqual([
      { type: 'context_usage', usedTokens: 21293, maxTokens: 1000000 },
      { type: 'usage', totalCostUsd: 0.42596 },
    ]);
  });

  it('reports only context fill when the update carries no cost', () => {
    expect(mapAcpUsageUpdate(CLAUDE_USAGE_MID_TURN)).toEqual([
      { type: 'context_usage', usedTokens: 21290, maxTokens: 1000000 },
    ]);
  });

  it('does not report a non-USD cost as dollars', () => {
    expect(
      mapAcpUsageUpdate({ ...OPENCODE_USAGE, cost: { amount: 3.5, currency: 'EUR' } })
    ).toEqual([{ type: 'context_usage', usedTokens: 19850, maxTokens: 200000 }]);
  });
});

describe('convertSessionUpdate', () => {
  it('turns a usage update into the turn cost the chat bridge keeps', () => {
    expect(convertSessionUpdate(CLAUDE_USAGE_END_OF_TURN)).toEqual({
      type: 'usage',
      totalCostUsd: 0.42596,
    });
    expect(convertSessionUpdate(CLAUDE_USAGE_MID_TURN)).toBeNull();
  });

  it('leaves config and mode updates to the session controls', () => {
    expect(
      convertSessionUpdate({
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'mode',
            name: 'Session Mode',
            category: 'mode',
            type: 'select',
            currentValue: 'plan',
            options: [
              { value: 'build', name: 'build' },
              { value: 'plan', name: 'plan' },
            ],
          },
        ],
      })
    ).toBeNull();
    expect(
      convertSessionUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })
    ).toBeNull();
  });
});

describe('mapAcpPromptUsage', () => {
  it("reads the turn's input and output tokens from the prompt reply", () => {
    expect(mapAcpPromptUsage(OPENCODE_PROMPT_REPLY)).toEqual({
      inputTokens: 18058,
      outputTokens: 3,
    });
    expect(mapAcpPromptUsage(CLAUDE_PROMPT_REPLY)).toEqual({ inputTokens: 2, outputTokens: 4 });
  });

  it('is null for an agent that reports no usage', () => {
    expect(mapAcpPromptUsage({ stopReason: 'end_turn' })).toBeNull();
    expect(mapAcpPromptUsage({ stopReason: 'end_turn', usage: null })).toBeNull();
  });

  it('refuses usage that is not token counts', () => {
    expect(() =>
      mapAcpPromptUsage({ stopReason: 'end_turn', usage: { inputTokens: 'many', outputTokens: 1 } })
    ).toThrow(/usage/);
  });
});
