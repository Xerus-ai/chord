import { describe, expect, it } from 'vitest';
import { getAgentDisplayName, resolveTurnAgentName } from './agent-display-name';

describe('getAgentDisplayName', () => {
  it("returns the provider's registered name", () => {
    expect(getAgentDisplayName('claude')).toBe('Claude Code');
    expect(getAgentDisplayName('codex')).toBe('Codex');
  });

  it('throws for an id that is not a registered provider', () => {
    expect(() => getAgentDisplayName('not-a-provider')).toThrow(/not-a-provider/);
  });
});

describe('resolveTurnAgentName', () => {
  it("names a turn after its session's provider, overriding a stored placeholder", () => {
    expect(resolveTurnAgentName({ sessionProviderId: 'codex', senderName: 'Chord Agent' })).toBe(
      'Codex'
    );
  });

  it('keeps the stored sender name when the turn has no session provider', () => {
    expect(resolveTurnAgentName({ sessionProviderId: null, senderName: 'Codex' })).toBe('Codex');
  });

  it('keeps the stored sender name when the session provider is unknown', () => {
    expect(resolveTurnAgentName({ sessionProviderId: 'retired', senderName: 'Gemini' })).toBe(
      'Gemini'
    );
  });

  it('labels a turn with neither as a generic agent', () => {
    expect(resolveTurnAgentName({ sessionProviderId: null, senderName: null })).toBe('Agent');
  });
});
