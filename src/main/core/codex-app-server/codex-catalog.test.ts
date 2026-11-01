import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { CODEX_MODELS, THREAD_START_POLICY } from './codex-captured-messages';
import { buildCodexCatalog, probeCodexCatalog } from './codex-catalog';
import { buildCodexTurnOverrides } from './codex-turn-overrides';

describe('buildCodexCatalog', () => {
  it('maps model/list into per-model effort levels, defaults and fast support', () => {
    const catalog = buildCodexCatalog(CODEX_MODELS);

    expect(catalog.providerId).toBe('codex');
    expect(catalog.source).toBe('probe');
    expect(catalog.permissionModes.map((m) => m.id)).toEqual([
      'read-only',
      'agent',
      'plan',
      'full-access',
    ]);
    expect(catalog.providerEfforts).toEqual([]);
    expect(catalog.models.map((m) => m.id)).toEqual(['gpt-6-astra', 'gpt-5.5']);

    const [astra, gpt55] = catalog.models;
    expect(astra.label).toBe('GPT-6-Astra');
    expect(astra.description).toBe('Our most capable model for complex, demanding work.');
    expect(astra.isDefault).toBe(true);
    expect(astra.efforts.map((e) => e.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
    expect(astra.efforts[3]).toEqual({ id: 'xhigh', label: 'Extra high' });
    expect(astra.defaultEffort).toBe('low');
    expect(astra.supportsFast).toBe(true);

    expect(gpt55.isDefault).toBe(false);
    expect(gpt55.efforts.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(gpt55.defaultEffort).toBe('medium');
  });

  it('leaves out models hidden from the picker', () => {
    const catalog = buildCodexCatalog([{ ...CODEX_MODELS[1], hidden: true }, CODEX_MODELS[0]]);
    expect(catalog.models.map((m) => m.id)).toEqual(['gpt-6-astra']);
  });

  it('marks no fast support for a model without a Fast service tier', () => {
    const catalog = buildCodexCatalog([{ ...CODEX_MODELS[0], serviceTiers: [] }]);
    expect(catalog.models[0].supportsFast).toBe(false);
  });

  it('refuses an empty model list', () => {
    expect(() => buildCodexCatalog([])).toThrow();
  });
});

describe('buildCodexTurnOverrides', () => {
  const defaults = { model: null, effort: null, fast: false };

  it('sends the default model at its default effort, standard speed, in agent mode', () => {
    expect(buildCodexTurnOverrides(CODEX_MODELS, defaults, 'agent', THREAD_START_POLICY)).toEqual({
      model: 'gpt-6-astra',
      effort: 'low',
      serviceTier: null,
      approvalPolicy: 'on-request',
      sandboxPolicy: THREAD_START_POLICY.sandbox,
      collaborationMode: {
        mode: 'default',
        settings: { model: 'gpt-6-astra', reasoning_effort: 'low', developer_instructions: null },
      },
    });
  });

  it('sends the picked model, effort, the Fast tier and plan mode on the thread policy', () => {
    expect(
      buildCodexTurnOverrides(
        CODEX_MODELS,
        { model: 'gpt-5.5', effort: 'high', fast: true },
        'plan',
        THREAD_START_POLICY
      )
    ).toEqual({
      model: 'gpt-5.5',
      effort: 'high',
      serviceTier: 'priority',
      approvalPolicy: 'on-request',
      sandboxPolicy: THREAD_START_POLICY.sandbox,
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-5.5', reasoning_effort: 'high', developer_instructions: null },
      },
    });
  });

  it('runs read only in a read-only sandbox that still asks', () => {
    const overrides = buildCodexTurnOverrides(
      CODEX_MODELS,
      defaults,
      'read-only',
      THREAD_START_POLICY
    );
    expect(overrides.approvalPolicy).toBe('on-request');
    expect(overrides.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
    expect(overrides.collaborationMode.mode).toBe('default');
  });

  it('runs full access unsandboxed and without asking', () => {
    const overrides = buildCodexTurnOverrides(
      CODEX_MODELS,
      defaults,
      'full-access',
      THREAD_START_POLICY
    );
    expect(overrides.approvalPolicy).toBe('never');
    expect(overrides.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
  });

  it('refuses a mode Codex does not offer', () => {
    expect(() =>
      buildCodexTurnOverrides(CODEX_MODELS, defaults, 'acceptEdits', THREAD_START_POLICY)
    ).toThrow(/mode/);
  });

  it('refuses a model the list does not offer', () => {
    expect(() =>
      buildCodexTurnOverrides(
        CODEX_MODELS,
        { model: 'gpt-4', effort: null, fast: false },
        'agent',
        THREAD_START_POLICY
      )
    ).toThrow();
  });
});

// Real CLI, no mocks: starts the installed `codex app-server`, initializes and
// asks for its model list. No turn is started, so nothing is billed.
describe('probeCodexCatalog', () => {
  it('returns the app-server model catalog', { timeout: 60_000 }, async () => {
    const catalog = await probeCodexCatalog('codex', homedir());

    expect(catalog.providerId).toBe('codex');
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.filter((m) => m.isDefault)).toHaveLength(1);
    expect(catalog.models.some((m) => m.efforts.length > 1)).toBe(true);
  });
});
