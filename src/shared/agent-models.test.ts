import { describe, expect, it } from 'vitest';
import { buildModelArgs, getStaticProviderControls } from './agent-models';

describe('getStaticProviderControls', () => {
  it('serves per-provider catalogs for agents with a verified model flag', () => {
    expect(getStaticProviderControls('gemini')?.models?.length).toBeGreaterThan(0);
    expect(getStaticProviderControls('cursor')?.models?.length).toBeGreaterThan(0);
  });

  it('has no entry for claude or codex, whose catalogs are probed from the agent', () => {
    expect(getStaticProviderControls('claude')).toBeUndefined();
    expect(getStaticProviderControls('codex')).toBeUndefined();
  });

  it('has no entry for providers whose interactive CLI has no model mechanism', () => {
    // droid's TUI takes no --model flag.
    expect(getStaticProviderControls('droid')).toBeUndefined();
  });
});

describe('buildModelArgs', () => {
  it('emits plain model flags for PTY providers', () => {
    expect(buildModelArgs('gemini', { model: 'gemini-3-pro-preview', effort: null })).toEqual([
      '-m',
      'gemini-3-pro-preview',
    ]);
    expect(buildModelArgs('cursor', { model: 'composer-2.5', effort: null })).toEqual([
      '--model',
      'composer-2.5',
    ]);
  });

  it('emits effort without a model for copilot', () => {
    expect(buildModelArgs('copilot', { model: null, effort: 'xhigh' })).toEqual([
      '--reasoning-effort',
      'xhigh',
    ]);
  });

  it('emits nothing for an empty selection or an uncataloged provider', () => {
    expect(buildModelArgs('gemini', { model: null, effort: null })).toEqual([]);
    expect(buildModelArgs('codex', { model: 'gpt-5.5', effort: 'high' })).toEqual([]);
    expect(buildModelArgs('droid', { model: 'gpt-5.4', effort: 'high' })).toEqual([]);
    expect(buildModelArgs('claude', { model: 'sonnet', effort: 'high' })).toEqual([]);
  });
});
