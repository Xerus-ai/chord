import { describe, expect, it } from 'vitest';
import {
  claudePermissionModes,
  CODEX_PERMISSION_MODES,
  modesForModel,
  pickPermissionMode,
} from './permission-modes';

describe('claudePermissionModes', () => {
  const modes = claudePermissionModes(['opus', 'sonnet']);

  it('offers the Claude Code modes, full access last, and not dontAsk', () => {
    expect(modes.map((m) => m.id)).toEqual([
      'default',
      'acceptEdits',
      'auto',
      'plan',
      'bypassPermissions',
    ]);
  });

  it('marks exactly one default, one plan mode and full access as danger', () => {
    expect(modes.filter((m) => m.isDefault).map((m) => m.id)).toEqual(['default']);
    expect(modes.filter((m) => m.isPlan).map((m) => m.id)).toEqual(['plan']);
    expect(modes.filter((m) => m.danger).map((m) => m.id)).toEqual(['bypassPermissions']);
  });

  it('limits auto mode to the models that report supporting it', () => {
    expect(modes.find((m) => m.id === 'auto')?.models).toEqual(['opus', 'sonnet']);
    expect(modes.find((m) => m.id === 'default')?.models).toBeUndefined();
  });

  it('leaves auto mode out when no model supports it', () => {
    expect(claudePermissionModes([]).some((m) => m.id === 'auto')).toBe(false);
  });
});

describe('CODEX_PERMISSION_MODES', () => {
  it('offers read only, agent (default), plan and full access (danger)', () => {
    expect(CODEX_PERMISSION_MODES.map((m) => [m.id, m.isDefault, m.isPlan, m.danger])).toEqual([
      ['read-only', false, false, false],
      ['agent', true, false, false],
      ['plan', false, true, false],
      ['full-access', false, false, true],
    ]);
  });
});

describe('modesForModel', () => {
  const modes = claudePermissionModes(['opus']);

  it('keeps a model-limited mode only for its models', () => {
    expect(modesForModel(modes, 'opus').some((m) => m.id === 'auto')).toBe(true);
    expect(modesForModel(modes, 'haiku').some((m) => m.id === 'auto')).toBe(false);
  });

  it('keeps only unlimited modes when the model is unknown', () => {
    expect(modesForModel(modes, undefined).map((m) => m.id)).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'bypassPermissions',
    ]);
  });
});

describe('pickPermissionMode', () => {
  const defaults = { claude: 'acceptEdits', codex: 'read-only' };

  it("takes the session's own pick over the agent's saved default", () => {
    expect(pickPermissionMode('plan', defaults, 'claude')).toBe('plan');
  });

  it("falls back to the agent's saved default when the session has no pick", () => {
    expect(pickPermissionMode(null, defaults, 'codex')).toBe('read-only');
  });

  it('is null when neither is set, leaving the choice to the catalog default', () => {
    expect(pickPermissionMode(null, defaults, 'opencode')).toBeNull();
    expect(pickPermissionMode(null, {}, 'claude')).toBeNull();
  });
});
