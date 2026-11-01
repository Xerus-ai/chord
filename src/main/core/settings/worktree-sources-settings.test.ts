import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from './schema';
import { getDefaultForKey } from './settings-registry';

/**
 * Settings › General › Worktree sources (plan §Phase 3 slice 6): which
 * checkouts made outside Chord are listed under their repository with Adopt,
 * by where they came from. A checkout of unknown origin starts
 * hidden (counted in "Review N worktrees"); Claude Code's own worktrees are
 * listed.
 */
describe('worktreeSources setting', () => {
  it("lists Claude Code's worktrees and hides other ones by default", () => {
    expect(getDefaultForKey('worktreeSources')).toEqual({ claudeCode: 'show', other: 'hide' });
  });

  it('accepts show or hide for each source, and nothing else', () => {
    const schema = appSettingsSchema.shape.worktreeSources;
    expect(schema.parse({ claudeCode: 'hide', other: 'show' })).toEqual({
      claudeCode: 'hide',
      other: 'show',
    });
    expect(schema.safeParse({ claudeCode: 'sometimes', other: 'show' }).success).toBe(false);
    expect(schema.safeParse({ claudeCode: 'show' }).success).toBe(false);
  });
});
