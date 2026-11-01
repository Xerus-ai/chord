import { describe, expect, it } from 'vitest';
import { buildWorktreeBranchName, describeLaneTag } from './worktrees';

describe('buildWorktreeBranchName', () => {
  it('slugs a title onto the work item branch', () => {
    expect(buildWorktreeBranchName('chord/my-feature-a3f', 'Fix the bug', [])).toBe(
      'chord/my-feature-a3f--fix-the-bug'
    );
  });

  it('falls back to --2 when no title is given', () => {
    expect(buildWorktreeBranchName('chord/my-feature-a3f', undefined, [])).toBe(
      'chord/my-feature-a3f--2'
    );
  });

  it('falls back to --3 when --2 is already taken', () => {
    expect(
      buildWorktreeBranchName('chord/my-feature-a3f', undefined, ['chord/my-feature-a3f--2'])
    ).toBe('chord/my-feature-a3f--3');
  });

  it('treats a blank (whitespace-only) title the same as no title', () => {
    expect(buildWorktreeBranchName('chord/my-feature-a3f', '   ', [])).toBe(
      'chord/my-feature-a3f--2'
    );
  });

  it('appends -2 when a titled slug collides with an existing branch', () => {
    const existing = ['chord/my-feature-a3f--fix-the-bug'];
    expect(buildWorktreeBranchName('chord/my-feature-a3f', 'Fix the bug', existing)).toBe(
      'chord/my-feature-a3f--fix-the-bug-2'
    );
  });

  it('keeps incrementing past -2 when that is also taken', () => {
    const existing = ['chord/my-feature-a3f--fix-the-bug', 'chord/my-feature-a3f--fix-the-bug-2'];
    expect(buildWorktreeBranchName('chord/my-feature-a3f', 'Fix the bug', existing)).toBe(
      'chord/my-feature-a3f--fix-the-bug-3'
    );
  });

  it('sanitises the title the same way branch names are sanitised elsewhere', () => {
    expect(buildWorktreeBranchName('chord/my-feature-a3f', 'fix: crash on ~HEAD^!', [])).toBe(
      'chord/my-feature-a3f--fix-crash-on-head'
    );
  });
});

describe('describeLaneTag', () => {
  // The short name a session tab shows for its lane (devstation-5u6, 6z9s).
  it("names a Chord lane by what follows its work item's branch", () => {
    expect(describeLaneTag('ada/fix-login--fork')).toBe('fork');
    expect(describeLaneTag('ada/fix-login--2')).toBe('2');
    expect(describeLaneTag('ada/fix-login--api-tests-2')).toBe('api-tests-2');
  });

  it('names any other branch by its last segment', () => {
    expect(describeLaneTag('feature/login')).toBe('login');
    expect(describeLaneTag('main')).toBe('main');
  });
});
