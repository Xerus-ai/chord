import { describe, expect, it } from 'vitest';
import { resolveSendProvider } from './resolve-send-provider';

describe('resolveSendProvider', () => {
  it("uses the targeted session's own provider over the composer's and the work item's", () => {
    expect(
      resolveSendProvider({
        targetRowProvider: 'claude',
        requestedProvider: 'gemini',
        itemProvider: 'codex',
      })
    ).toBe('claude');
  });

  it("uses the Room composer's selected agent for an untargeted send", () => {
    expect(
      resolveSendProvider({
        targetRowProvider: undefined,
        requestedProvider: 'gemini',
        itemProvider: 'codex',
      })
    ).toBe('gemini');
  });

  it('uses the composer agent when the work item has no provider yet', () => {
    expect(
      resolveSendProvider({
        targetRowProvider: undefined,
        requestedProvider: 'codex',
        itemProvider: null,
      })
    ).toBe('codex');
  });

  it('uses the work item provider when neither the row nor the caller names one', () => {
    expect(
      resolveSendProvider({
        targetRowProvider: null,
        requestedProvider: undefined,
        itemProvider: 'codex',
      })
    ).toBe('codex');
    expect(
      resolveSendProvider({
        targetRowProvider: 'not-a-provider',
        requestedProvider: undefined,
        itemProvider: 'codex',
      })
    ).toBe('codex');
  });

  it('ignores an unknown requested provider', () => {
    expect(
      resolveSendProvider({
        targetRowProvider: undefined,
        requestedProvider: 'not-a-provider',
        itemProvider: 'codex',
      })
    ).toBe('codex');
  });

  it('returns null instead of inventing an agent when nothing names one', () => {
    expect(
      resolveSendProvider({
        targetRowProvider: undefined,
        requestedProvider: undefined,
        itemProvider: null,
      })
    ).toBeNull();
  });
});
