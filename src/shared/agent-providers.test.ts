import { describe, expect, it } from 'vitest';
import { AGENT_PROVIDER_IDS } from './agent-provider-registry';
import { AGENT_PROVIDERS, getProvider, listDetectableProviders } from './agent-providers';

/**
 * The agents Chord knows, split by how they run (devstation-nntv: the one
 * 624-line registry), still read as one list: every id has exactly one
 * definition, and the order every agent list shows (onboarding, Settings,
 * the + menu) is the order it was before the split.
 */
describe('AGENT_PROVIDERS', () => {
  it('keeps the order agent lists show', () => {
    expect(AGENT_PROVIDERS.map((provider) => provider.id)).toEqual([
      'codex',
      'claude',
      'devin',
      'cursor',
      'gemini',
      'qwen',
      'droid',
      'amp',
      'opencode',
      'hermes',
      'copilot',
      'charm',
      'auggie',
      'goose',
      'kimi',
      'kilocode',
      'kiro',
      'rovo',
      'cline',
      'continue',
      'codebuff',
      'mistral',
      'pi',
      'autohand',
      'roo',
    ]);
  });

  it('defines every provider id exactly once', () => {
    const ids = AGENT_PROVIDERS.map((provider) => provider.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...AGENT_PROVIDER_IDS].sort());
  });

  it('finds a provider by id', () => {
    expect(getProvider('codex')?.name).toBe('Codex');
    expect(getProvider('claude')?.communication).toBe('acp');
  });

  it('lists the providers it can detect on this machine', () => {
    const detectable = listDetectableProviders().map((provider) => provider.id);

    expect(detectable).toContain('codex');
    expect(detectable.every((id) => getProvider(id)?.commands?.length)).toBe(true);
  });
});
