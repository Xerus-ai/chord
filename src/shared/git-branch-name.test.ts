import { describe, expect, it } from 'vitest';
import { toBranchSlug } from './git-branch-name';

describe('toBranchSlug', () => {
  it('lowercases and hyphenates a human work item name', () => {
    expect(toBranchSlug('Add Repository Management')).toBe('add-repository-management');
  });

  it('strips characters git refs reject, rather than passing them through', () => {
    // space ~ ^ : ? * [ \ are all illegal in a ref component.
    expect(toBranchSlug('fix: crash on ~HEAD^ [urgent]?')).toBe('fix-crash-on-head-urgent');
  });

  it('never produces a leading or trailing hyphen', () => {
    expect(toBranchSlug('  ...leading and trailing...  ')).toBe('leading-and-trailing');
  });

  it('truncates long names without leaving a trailing hyphen', () => {
    const slug = toBranchSlug(`${'a'.repeat(46)} overflowing tail`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to a usable slug when nothing survives sanitising', () => {
    expect(toBranchSlug('!!! ???')).toBe('work-item');
  });
});
