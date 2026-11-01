import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from './schema';
import { getDefaultForKey } from './settings-registry';

/**
 * Settings › Git (plan 2026-09-26, "Settings" table): the base a lane's
 * committed changes are measured against, and which group the Changes panel
 * lists first. Both are per-user: the compare base defaults to the
 * repository default, and the group order to `changes-first`.
 */
describe('git setting', () => {
  it('defaults to the repository default base and Changes first', () => {
    expect(getDefaultForKey('git')).toEqual({
      compareBase: 'repoDefault',
      sourceControlGroupOrder: 'changes',
    });
  });

  it('accepts repoDefault or upstream as the compare base, and nothing else', () => {
    const schema = appSettingsSchema.shape.git;
    expect(schema.parse({ compareBase: 'upstream', sourceControlGroupOrder: 'changes' })).toEqual({
      compareBase: 'upstream',
      sourceControlGroupOrder: 'changes',
    });
    expect(
      schema.safeParse({ compareBase: 'origin/main', sourceControlGroupOrder: 'changes' }).success
    ).toBe(false);
  });

  it('accepts changes, staged or untracked as the group order, and nothing else', () => {
    const schema = appSettingsSchema.shape.git;
    for (const order of ['changes', 'staged', 'untracked'] as const) {
      expect(
        schema.parse({ compareBase: 'repoDefault', sourceControlGroupOrder: order })
          .sourceControlGroupOrder
      ).toBe(order);
    }
    expect(
      schema.safeParse({ compareBase: 'repoDefault', sourceControlGroupOrder: 'conflicts' }).success
    ).toBe(false);
  });
});
