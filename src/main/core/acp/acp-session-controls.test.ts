import { describe, expect, it } from 'vitest';
import type { AgentControlCatalog } from '@shared/agent-control-catalog';
import {
  CLAUDE_MODELS,
  CLAUDE_MODES,
  CLAUDE_NEW_SESSION,
  claudeConfigOptions,
  OPENCODE_CONFIG_OPTIONS,
} from './acp-captured-replies';
import {
  acpEffortTarget,
  acpModelTarget,
  acpModeTarget,
  acpSetRequest,
  applyCurrentModeUpdate,
  buildAcpCatalog,
  findPlanModeValue,
  readAcpControls,
  type AcpSessionControls,
} from './acp-session-controls';

describe('readAcpControls', () => {
  it('reads opencode config options: a model and a mode select, no effort', () => {
    const controls = readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS });

    expect(controls.model?.setter).toEqual({ kind: 'config', configId: 'model' });
    expect(controls.model?.currentValue).toBe('opencode/big-pickle');
    expect(controls.model?.options).toHaveLength(7);
    expect(controls.model?.options[2]).toEqual({
      value: 'opencode/mimo-v2.6-flash-free',
      name: 'OpenCode Zen/MiMo-V2.6-Flash Free',
    });
    expect(controls.effort).toBeNull();
    expect(controls.mode?.setter).toEqual({ kind: 'config', configId: 'mode' });
    expect(controls.mode?.currentValue).toBe('build');
  });

  it('prefers config options over the legacy models/modes fields when both are sent', () => {
    const controls = readAcpControls(CLAUDE_NEW_SESSION);

    expect(controls.model?.setter).toEqual({ kind: 'config', configId: 'model' });
    expect(controls.effort?.setter).toEqual({ kind: 'config', configId: 'effort' });
    expect(controls.effort?.currentValue).toBe('medium');
    expect(controls.effort?.options.map((o) => o.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(controls.mode?.setter).toEqual({ kind: 'config', configId: 'mode' });
  });

  it('reads the legacy models/modes fields when an agent sends no config options', () => {
    const controls = readAcpControls({ models: CLAUDE_MODELS, modes: CLAUDE_MODES });

    expect(controls.model?.setter).toEqual({ kind: 'legacy-model' });
    expect(controls.model?.currentValue).toBe('claude-fable-5-1[1m]');
    expect(controls.model?.options[3]).toEqual({
      value: 'sonnet',
      name: 'Sonnet',
      description: 'Sonnet 5 · Efficient for routine tasks',
    });
    expect(controls.effort).toBeNull();
    expect(controls.mode?.setter).toEqual({ kind: 'legacy-mode' });
    expect(controls.mode?.currentValue).toBe('default');
  });

  it('flattens grouped select options', () => {
    const controls = readAcpControls({
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'b',
          options: [
            { group: 'g1', name: 'Group 1', options: [{ value: 'a', name: 'A' }] },
            { group: 'g2', name: 'Group 2', options: [{ value: 'b', name: 'B' }] },
          ],
        },
      ],
    });

    expect(controls.model?.options.map((o) => o.value)).toEqual(['a', 'b']);
  });

  it('ignores boolean options and categories it does not control', () => {
    const controls = readAcpControls({
      configOptions: [
        { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false },
        {
          id: 'verbosity',
          name: 'Verbosity',
          category: 'model_config',
          type: 'select',
          currentValue: 'low',
          options: [{ value: 'low', name: 'Low' }],
        },
      ],
    });

    expect(controls).toEqual({ model: null, effort: null, mode: null });
  });

  it('keeps the previous control for anything a later update does not mention', () => {
    const initial = readAcpControls(CLAUDE_NEW_SESSION);
    const next = readAcpControls({ configOptions: [OPENCODE_CONFIG_OPTIONS[0]] }, initial);

    expect(next.model?.currentValue).toBe('opencode/big-pickle');
    expect(next.effort).toEqual(initial.effort);
    expect(next.mode).toEqual(initial.mode);
  });
});

describe('applyCurrentModeUpdate', () => {
  it('moves the mode control to the agent-reported mode', () => {
    const controls = readAcpControls(CLAUDE_NEW_SESSION);
    const next = applyCurrentModeUpdate(controls, 'plan');

    expect(next.mode?.currentValue).toBe('plan');
    expect(next.model).toEqual(controls.model);
  });
});

describe('findPlanModeValue', () => {
  it('finds a mode whose id is plan', () => {
    expect(findPlanModeValue(readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS }))).toBe(
      'plan'
    );
  });

  it('finds a namespaced mode id ending in #plan', () => {
    const controls = readAcpControls({
      modes: {
        currentModeId: 'agent#code',
        availableModes: [
          { id: 'agent#code', name: 'Code' },
          { id: 'agent#plan', name: 'Plan' },
        ],
      },
    });
    expect(findPlanModeValue(controls)).toBe('agent#plan');
  });

  it('is null when the agent has no plan mode', () => {
    const controls = readAcpControls({
      modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] },
    });
    expect(findPlanModeValue(controls)).toBeNull();
    expect(findPlanModeValue({ model: null, effort: null, mode: null })).toBeNull();
  });
});

describe('buildAcpCatalog', () => {
  it('maps the opencode session reply into a session catalog', () => {
    const catalog = buildAcpCatalog(
      'opencode',
      readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS }),
      null
    );

    expect(catalog.providerId).toBe('opencode');
    expect(catalog.source).toBe('session');
    expect(catalog.permissionModes).toEqual([
      {
        id: 'build',
        label: 'build',
        description: 'The default agent. Executes tools based on configured permissions.',
        isDefault: true,
        isPlan: false,
        danger: false,
      },
      {
        id: 'plan',
        label: 'plan',
        description: 'Plan mode. Disallows all edit tools.',
        isDefault: false,
        isPlan: true,
        danger: false,
      },
    ]);
    expect(catalog.providerEfforts).toEqual([]);
    expect(catalog.models).toHaveLength(7);
    expect(catalog.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual([
      'opencode/big-pickle',
    ]);
    expect(catalog.models[0]).toEqual({
      id: 'opencode/big-pickle',
      label: 'OpenCode Zen/Big Pickle',
      isDefault: true,
      efforts: [],
      supportsFast: false,
    });
  });

  it('gives the current model the agent-reported effort levels and default effort', () => {
    const catalog = buildAcpCatalog('claude', readAcpControls(CLAUDE_NEW_SESSION), null);
    const fable = catalog.models.find((m) => m.id === 'claude-fable-5-1[1m]');
    const sonnet = catalog.models.find((m) => m.id === 'sonnet');

    expect(fable?.isDefault).toBe(true);
    expect(fable?.description).toBe(
      'Fable 5.1 · Most capable for your hardest and longest-running tasks'
    );
    expect(fable?.efforts.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(fable?.efforts[3]).toEqual({ id: 'xhigh', label: 'Extra high' });
    expect(fable?.defaultEffort).toBe('medium');
    // Only the current model's levels are reported; others are not guessed.
    expect(sonnet?.efforts).toEqual([]);
    expect(sonnet?.defaultEffort).toBeUndefined();
  });

  it('keeps the session default and learned efforts as the current model changes', () => {
    const first = buildAcpCatalog('claude', readAcpControls(CLAUDE_NEW_SESSION), null);
    const afterSwitch = buildAcpCatalog(
      'claude',
      readAcpControls({ configOptions: claudeConfigOptions('sonnet', 'medium', 'default') }),
      first
    );
    const afterEffort = buildAcpCatalog(
      'claude',
      readAcpControls({ configOptions: claudeConfigOptions('sonnet', 'high', 'default') }),
      afterSwitch
    );

    const byId = (c: AgentControlCatalog, id: string) => c.models.find((m) => m.id === id);
    expect(afterEffort.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual([
      'claude-fable-5-1[1m]',
    ]);
    expect(byId(afterEffort, 'claude-fable-5-1[1m]')?.efforts).toHaveLength(5);
    expect(byId(afterEffort, 'sonnet')?.efforts).toHaveLength(5);
    // The level the agent picked on switching is the model's default; a later
    // explicit pick does not overwrite it.
    expect(byId(afterEffort, 'sonnet')?.defaultEffort).toBe('medium');
  });

  it('marks the current model default when the previous default is gone', () => {
    const previous = buildAcpCatalog(
      'opencode',
      readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS }),
      null
    );
    const catalog = buildAcpCatalog(
      'opencode',
      readAcpControls({
        configOptions: [
          {
            ...OPENCODE_CONFIG_OPTIONS[0],
            currentValue: 'opencode/nemotron-3-ultra-free',
            options: OPENCODE_CONFIG_OPTIONS[0].options.slice(1),
          },
        ],
      }),
      previous
    );

    expect(catalog.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual([
      'opencode/nemotron-3-ultra-free',
    ]);
  });

  it('offers effort levels provider-wide when the agent reports no model control', () => {
    const catalog = buildAcpCatalog(
      'goose',
      readAcpControls({ configOptions: [claudeConfigOptions('sonnet', 'low', 'default')[2]] }),
      null
    );

    expect(catalog.models).toEqual([]);
    expect(catalog.providerEfforts.map((e) => e.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(catalog.permissionModes).toEqual([]);
  });

  it('offers every mode claude-agent-acp reports, marking bypassPermissions as danger', () => {
    const catalog = buildAcpCatalog('claude', readAcpControls(CLAUDE_NEW_SESSION), null);
    expect(catalog.permissionModes.map((m) => [m.id, m.isDefault, m.isPlan, m.danger])).toEqual([
      ['auto', false, false, false],
      ['default', true, false, false],
      ['acceptEdits', false, false, false],
      ['plan', false, true, false],
      ['dontAsk', false, false, false],
      ['bypassPermissions', false, false, true],
    ]);
  });

  it('keeps the mode the session started in as its default after the agent switches', () => {
    const first = buildAcpCatalog(
      'opencode',
      readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS }),
      null
    );
    const inPlan = buildAcpCatalog(
      'opencode',
      applyCurrentModeUpdate(readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS }), 'plan'),
      first
    );
    expect(inPlan.permissionModes.filter((m) => m.isDefault).map((m) => m.id)).toEqual(['build']);
  });
});

describe('acpSetRequest', () => {
  it('sets a config option by id', () => {
    const controls = readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS });
    expect(acpSetRequest(controls.model!, 'opencode/mimo-v2.6-flash-free')).toEqual({
      method: 'session/set_config_option',
      params: { configId: 'model', value: 'opencode/mimo-v2.6-flash-free' },
    });
  });

  it('uses session/set_model and session/set_mode for legacy controls', () => {
    const controls = readAcpControls({ models: CLAUDE_MODELS, modes: CLAUDE_MODES });
    expect(acpSetRequest(controls.model!, 'sonnet')).toEqual({
      method: 'session/set_model',
      params: { modelId: 'sonnet' },
    });
    expect(acpSetRequest(controls.mode!, 'plan')).toEqual({
      method: 'session/set_mode',
      params: { modeId: 'plan' },
    });
  });
});

describe('selection targets', () => {
  const controls: AcpSessionControls = readAcpControls(CLAUDE_NEW_SESSION);
  const catalog = buildAcpCatalog('claude', controls, null);

  it('targets the picked model, or the session default for a default pick', () => {
    expect(acpModelTarget(controls, catalog, { model: 'sonnet', effort: null, fast: false })).toBe(
      'sonnet'
    );
    expect(
      acpModelTarget(controls, catalog, { model: null, effort: null, fast: false })
    ).toBeNull();

    const switched = readAcpControls({
      configOptions: claudeConfigOptions('sonnet', 'medium', 'default'),
    });
    expect(acpModelTarget(switched, catalog, { model: null, effort: null, fast: false })).toBe(
      'claude-fable-5-1[1m]'
    );
  });

  it('targets the picked effort, or the model default effort for a default pick', () => {
    const atHigh = readAcpControls({
      configOptions: claudeConfigOptions('claude-fable-5-1[1m]', 'high', 'default'),
    });
    expect(acpEffortTarget(controls, catalog, { model: null, effort: 'high', fast: false })).toBe(
      'high'
    );
    expect(
      acpEffortTarget(atHigh, catalog, { model: null, effort: 'high', fast: false })
    ).toBeNull();
    expect(acpEffortTarget(atHigh, catalog, { model: null, effort: null, fast: false })).toBe(
      'medium'
    );
  });

  it('has no effort target for an agent without an effort control', () => {
    const opencode = readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS });
    const opencodeCatalog = buildAcpCatalog('opencode', opencode, null);
    expect(
      acpEffortTarget(opencode, opencodeCatalog, { model: null, effort: null, fast: false })
    ).toBeNull();
  });

  it('targets the picked mode, and nothing when the agent is already in it', () => {
    const opencode = readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS });
    expect(acpModeTarget(opencode, 'plan')).toBe('plan');
    expect(acpModeTarget(opencode, 'build')).toBeNull();

    const inPlan = applyCurrentModeUpdate(opencode, 'plan');
    expect(acpModeTarget(inPlan, 'plan')).toBeNull();
    expect(acpModeTarget(inPlan, 'build')).toBe('build');
  });

  it('refuses a mode the agent does not offer', () => {
    const opencode = readAcpControls({ configOptions: OPENCODE_CONFIG_OPTIONS });
    expect(() => acpModeTarget(opencode, 'acceptEdits')).toThrow(/does not offer mode/);
  });

  it('refuses a mode switch for an agent without a mode control', () => {
    expect(() => acpModeTarget({ model: null, effort: null, mode: null }, 'plan')).toThrow();
  });
});
