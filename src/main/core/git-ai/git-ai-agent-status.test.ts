import { describe, expect, it } from 'vitest';
import { interpretClaudeAccount, interpretCodexAccount } from './git-ai-agent-status';

/**
 * Whether the chosen agent can answer now, so the Generate button can say why
 * it can't before anything runs. Inputs are what each agent reports: Claude's
 * `accountInfo()` (probed 2026-10-03 on Claude Code 0.3.265's SDK: an OAuth
 * login returns `email` and `apiProvider: 'firstParty'`; an empty config dir
 * returns `tokenSource: 'none'` and no email), and Codex's `account/read`.
 */
describe('interpretClaudeAccount', () => {
  it('is ready for an OAuth login', () => {
    expect(
      interpretClaudeAccount({
        email: 'dev@example.com',
        organization: "dev@example.com's Organization",
        subscriptionType: 'Claude Max',
        apiProvider: 'firstParty',
      })
    ).toEqual({ state: 'ready' });
  });

  it('is ready with an API key', () => {
    expect(
      interpretClaudeAccount({ apiKeySource: 'ANTHROPIC_API_KEY', apiProvider: 'firstParty' })
    ).toEqual({ state: 'ready' });
  });

  it('is ready on a third-party provider, whose auth is external', () => {
    expect(interpretClaudeAccount({ apiProvider: 'bedrock' })).toEqual({ state: 'ready' });
  });

  it('is not signed in with no token', () => {
    const status = interpretClaudeAccount({ tokenSource: 'none', apiProvider: 'firstParty' });
    expect(status.state).toBe('not_signed_in');
    expect(status.state === 'not_signed_in' && status.message).toMatch(/Claude Code/);
  });
});

describe('interpretCodexAccount', () => {
  it('is ready with a ChatGPT login or an API key', () => {
    expect(
      interpretCodexAccount({
        account: { type: 'chatgpt', email: 'dev@example.com', planType: 'pro' },
        requiresOpenaiAuth: true,
      })
    ).toEqual({ state: 'ready' });
    expect(
      interpretCodexAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true })
    ).toEqual({ state: 'ready' });
  });

  it('is not signed in with no account when OpenAI auth is required', () => {
    const status = interpretCodexAccount({ account: null, requiresOpenaiAuth: true });
    expect(status.state).toBe('not_signed_in');
    expect(status.state === 'not_signed_in' && status.message).toMatch(/Codex/);
  });

  it('is ready with no account when the provider needs no OpenAI auth', () => {
    expect(interpretCodexAccount({ account: null, requiresOpenaiAuth: false })).toEqual({
      state: 'ready',
    });
  });
});
