import { describe, expect, it } from 'vitest';
import type { AgentControlCatalog } from '@shared/agent-control-catalog';
import type { PermissionModeOption } from '@shared/permission-modes';
import { describeSessionAgentLabels } from './session-agent-labels';

/**
 * What a teammate's composer shows of the owner's chat (user decision
 * 2026-10-01): the labels the owner's own composer shows, resolved on the
 * owner's machine from the agent's catalog, so a teammate without that agent
 * installed still reads "Opus 4.5" and "Ask before edits".
 */
const mode = (id: string, label: string, isDefault = false): PermissionModeOption => ({
  id,
  label,
  isDefault,
  isPlan: id === 'plan',
  danger: false,
});

const catalog: AgentControlCatalog = {
  providerId: 'claude',
  source: 'static',
  models: [
    {
      id: 'opus',
      label: 'Opus 4.5',
      isDefault: true,
      efforts: [],
      supportsFast: false,
    },
    {
      id: 'haiku',
      label: 'Haiku 4.5',
      isDefault: false,
      efforts: [],
      supportsFast: false,
    },
  ],
  providerEfforts: [],
  permissionModes: [
    mode('default', 'Ask before edits', true),
    mode('acceptEdits', 'Edit automatically'),
    mode('plan', 'Plan mode'),
  ],
};

describe('describeSessionAgentLabels', () => {
  it('names the picked model and mode as the owner sees them', () => {
    expect(describeSessionAgentLabels(catalog, { model: 'haiku', permissionMode: 'plan' })).toEqual(
      { modelLabel: 'Haiku 4.5', permissionModeLabel: 'Plan mode' }
    );
  });

  it('with no pick, names the agent defaults, as the session will run them', () => {
    expect(describeSessionAgentLabels(catalog, { model: null, permissionMode: null })).toEqual({
      modelLabel: 'Opus 4.5',
      permissionModeLabel: 'Ask before edits',
    });
  });

  it('names no model the catalog does not list, as the owner sees just the agent', () => {
    // model-control.tsx shows `current?.label ?? providerName`: an unlisted
    // model reads as the agent alone, so a teammate sees the same.
    expect(
      describeSessionAgentLabels(catalog, { model: 'opus-next', permissionMode: null }).modelLabel
    ).toBeNull();
  });

  it('has no mode label for an agent with no mode control', () => {
    const modeless = { ...catalog, permissionModes: [] };
    expect(
      describeSessionAgentLabels(modeless, { model: null, permissionMode: null })
        .permissionModeLabel
    ).toBeNull();
  });
});
