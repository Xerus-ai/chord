import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from './schema';
import { getDefaultForKey } from './settings-registry';

/**
 * Settings › Git "Auto-update .gitignore" (`writeAgentConfigToGitIgnore`) is
 * gone (plan 2026-09-26, "Deleted"; devstation-bmj): Chord's agent hooks are
 * passed at launch and nothing of Chord's goes into a tracked .gitignore, so
 * there is nothing left for it to switch.
 */
describe('localProject setting', () => {
  it('has no .gitignore switch by default', () => {
    expect(getDefaultForKey('localProject')).not.toHaveProperty('writeAgentConfigToGitIgnore');
  });

  it('drops a value stored by an older build the next time the setting is saved', () => {
    const parsed = appSettingsSchema.shape.localProject.parse({
      ...getDefaultForKey('localProject'),
      writeAgentConfigToGitIgnore: false,
    });
    expect(parsed).not.toHaveProperty('writeAgentConfigToGitIgnore');
  });
});
