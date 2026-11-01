import { describe, expect, it } from 'vitest';
import {
  buildClaudeCatalog,
  buildStaticCatalog,
  effortsForModel,
  formatEffortLabel,
  permissionModesForModel,
  resolveCatalogSelection,
  resolvePermissionMode,
  type ClaudeProbeModel,
} from './agent-control-catalog';

// Captured from `query().supportedModels()` against Claude Code 2.1.280 on
// 2026-09-23 — the real probe output, trimmed of fields the catalog ignores.
// `supportsAutoMode` as the SDK 0.3.265 probe reported it the same day: every
// model but Haiku.
const PROBED: ClaudeProbeModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-fable-5-1[1m]',
    resolvedModel: 'claude-fable-5-1',
    displayName: 'Fable',
    description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers',
  },
];

describe('buildClaudeCatalog', () => {
  const catalog = buildClaudeCatalog(PROBED);

  it('drops the synthetic default row and marks the model it resolves to as default', () => {
    expect(catalog.models.map((m) => m.id)).toEqual([
      'opus[1m]',
      'claude-fable-5-1[1m]',
      'sonnet',
      'haiku',
    ]);
    expect(catalog.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual(['opus[1m]']);
  });

  it('labels each model by the name the description leads with', () => {
    expect(catalog.models.map((m) => m.label)).toEqual([
      'Opus 5 with 1M context',
      'Fable 5.1',
      'Sonnet 5',
      'Haiku 4.5',
    ]);
  });

  it('carries per-model effort levels and fast-mode support', () => {
    const haiku = catalog.models.find((m) => m.id === 'haiku');
    const opus = catalog.models.find((m) => m.id === 'opus[1m]');
    expect(haiku?.efforts).toEqual([]);
    expect(haiku?.supportsFast).toBe(false);
    expect(opus?.efforts.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(opus?.supportsFast).toBe(true);
  });

  it('is a probe-sourced catalog offering the Claude Code permission modes', () => {
    expect(catalog.source).toBe('probe');
    expect(catalog.permissionModes.map((m) => m.id)).toEqual([
      'default',
      'acceptEdits',
      'auto',
      'plan',
      'bypassPermissions',
    ]);
  });

  it('offers auto mode on the models that support it', () => {
    expect(catalog.permissionModes.find((m) => m.id === 'auto')?.models).toEqual([
      'opus[1m]',
      'claude-fable-5-1[1m]',
      'sonnet',
    ]);
  });

  it('throws on an empty probe instead of presenting an empty picker', () => {
    expect(() => buildClaudeCatalog([])).toThrow(/no models/i);
  });
});

// The same probe once Claude Code has its server-served model list (Claude
// Code 2.1.265, SDK 0.3.265, captured 2026-09-24; first five rows). A served
// row names the model in `displayName` and its description is only the
// slogan; the `default` pointer resolves to a model no row lists.
const SERVED: ClaudeProbeModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: 'claude-fable-5-1',
    resolvedModel: 'claude-fable-5-1',
    displayName: 'Fable 5.1',
    description: 'For your toughest challenges',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet 5',
    description: 'Most efficient for everyday tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    description: 'Fastest for quick answers',
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5',
    displayName: 'Opus 5',
    description: 'Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsFastMode: true,
    supportsAutoMode: true,
  },
];

describe('buildClaudeCatalog on the served model list', () => {
  const catalog = buildClaudeCatalog(SERVED);

  it('labels each model by its name, not its slogan', () => {
    expect(catalog.models.find((m) => m.id === 'haiku')?.label).toBe('Haiku 4.5');
    expect(catalog.models.find((m) => m.id === 'claude-fable-5-1')?.label).toBe('Fable 5.1');
  });

  it('keeps the default pointer as the default when no row is the model it resolves to', () => {
    const defaults = catalog.models.filter((m) => m.isDefault);
    expect(defaults.map((m) => [m.id, m.label])).toEqual([['default', 'Opus 5 with 1M context']]);
    expect(catalog.models.map((m) => m.id)).toEqual([
      'default',
      'claude-fable-5-1',
      'sonnet',
      'haiku',
      'opus',
    ]);
  });
});

describe('effortsForModel', () => {
  const catalog = buildClaudeCatalog(PROBED);

  it("returns the selected model's levels", () => {
    expect(effortsForModel(catalog, 'haiku')).toEqual([]);
    expect(effortsForModel(catalog, 'sonnet').map((e) => e.id)).toContain('max');
  });

  it("uses the default model's levels when no model is selected", () => {
    expect(effortsForModel(catalog, null).map((e) => e.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('uses provider-wide levels for a provider with no model catalog', () => {
    const copilot = buildStaticCatalog('copilot');
    expect(copilot.models).toEqual([]);
    expect(effortsForModel(copilot, null).map((e) => e.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });
});

describe('resolveCatalogSelection', () => {
  const catalog = buildClaudeCatalog(PROBED);

  it('keeps a valid model, effort and fast choice', () => {
    expect(
      resolveCatalogSelection(catalog, { model: 'opus[1m]', effort: 'max', fast: true })
    ).toEqual({ model: 'opus[1m]', effort: 'max', fast: true });
  });

  it('drops a model this provider does not offer to the provider default', () => {
    expect(
      resolveCatalogSelection(catalog, { model: 'gpt-5.4', effort: null, fast: false }).model
    ).toBeNull();
  });

  it("drops an effort the selected model doesn't support", () => {
    expect(
      resolveCatalogSelection(catalog, { model: 'haiku', effort: 'high', fast: false }).effort
    ).toBeNull();
  });

  it("drops fast on a model that can't run fast", () => {
    expect(
      resolveCatalogSelection(catalog, { model: 'sonnet', effort: null, fast: true }).fast
    ).toBe(false);
  });

  it('judges fast against the default model when none is selected', () => {
    expect(resolveCatalogSelection(catalog, { model: null, effort: null, fast: true }).fast).toBe(
      true
    );
  });
});

describe('buildStaticCatalog', () => {
  it('serves the verified per-provider model lists', () => {
    expect(buildStaticCatalog('gemini').models.length).toBeGreaterThan(0);
    expect(buildStaticCatalog('cursor').models.length).toBeGreaterThan(0);
  });

  it('has no permission modes and no fast mode for static providers', () => {
    const gemini = buildStaticCatalog('gemini');
    expect(gemini.permissionModes).toEqual([]);
    expect(gemini.models.every((m) => !m.supportsFast)).toBe(true);
  });

  it('is empty for a provider with no model mechanism', () => {
    const droid = buildStaticCatalog('droid');
    expect(droid.models).toEqual([]);
    expect(droid.providerEfforts).toEqual([]);
  });
});

describe('formatEffortLabel', () => {
  it('names each level for the menu', () => {
    expect(formatEffortLabel('low')).toBe('Low');
    expect(formatEffortLabel('xhigh')).toBe('Extra high');
    expect(formatEffortLabel('max')).toBe('Max');
    expect(formatEffortLabel('minimal')).toBe('Minimal');
  });
});

describe('permissionModesForModel', () => {
  const catalog = buildClaudeCatalog(PROBED);

  it('offers auto mode for a model that supports it, not for Haiku', () => {
    expect(permissionModesForModel(catalog, 'sonnet').some((m) => m.id === 'auto')).toBe(true);
    expect(permissionModesForModel(catalog, 'haiku').some((m) => m.id === 'auto')).toBe(false);
  });

  it('judges the default model when none is selected', () => {
    expect(permissionModesForModel(catalog, null).some((m) => m.id === 'auto')).toBe(true);
  });
});

describe('resolvePermissionMode', () => {
  const catalog = buildClaudeCatalog(PROBED);

  it('keeps a stored mode the model offers', () => {
    expect(resolvePermissionMode(catalog, 'opus[1m]', 'acceptEdits')?.id).toBe('acceptEdits');
  });

  it('resolves no stored mode to the default mode', () => {
    expect(resolvePermissionMode(catalog, null, null)?.id).toBe('default');
  });

  it("drops a mode the selected model doesn't offer to the default", () => {
    expect(resolvePermissionMode(catalog, 'haiku', 'auto')?.id).toBe('default');
  });

  it('drops a mode left by another provider to the default', () => {
    expect(resolvePermissionMode(catalog, null, 'full-access')?.id).toBe('default');
  });

  it('is null for a provider with no permission modes', () => {
    expect(resolvePermissionMode(buildStaticCatalog('gemini'), null, 'plan')).toBeNull();
  });
});
