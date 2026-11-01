import { describe, expect, it } from 'vitest';
import { classifyWorktreeSource, pickAdoptionName } from './worktree-sources';

/**
 * Plan §Phase 3 slice 6: a checkout made outside Chord is named by where it
 * came from — Claude Code puts its worktrees at `<repo>/.claude/worktrees/*`,
 * anything else is `other` — and an adopted checkout's work item is named
 * after the newest agent session found in it, else its branch.
 */
describe('classifyWorktreeSource', () => {
  it("reads a folder directly under .claude/worktrees as Claude Code's, on either separator", () => {
    expect(classifyWorktreeSource('C:\\code\\app\\.claude\\worktrees\\fix-login')).toBe(
      'claudeCode'
    );
    expect(classifyWorktreeSource('/home/ana/app/.claude/worktrees/fix-login')).toBe('claudeCode');
    expect(classifyWorktreeSource('/home/ana/app/.claude/worktrees/fix-login/')).toBe('claudeCode');
  });

  it('reads every other folder as other', () => {
    expect(classifyWorktreeSource('/home/ana/worktrees/fix-login')).toBe('other');
    expect(classifyWorktreeSource('/home/ana/app/.claude/fix-login')).toBe('other');
    expect(classifyWorktreeSource('/home/ana/app/claude/worktrees/fix-login')).toBe('other');
    expect(classifyWorktreeSource('C:\\code\\app-fix-login')).toBe('other');
  });

  it('reads a folder nested deeper than one level under .claude/worktrees as other', () => {
    expect(classifyWorktreeSource('/home/ana/app/.claude/worktrees/fix-login/packages/web')).toBe(
      'other'
    );
  });
});

describe('pickAdoptionName', () => {
  it("is the newest found session's title", () => {
    expect(
      pickAdoptionName(
        [
          { title: 'Older chat', lastActivityAt: 1_000 },
          { title: 'Ledger job migration', lastActivityAt: 3_000 },
          { title: 'Middle chat', lastActivityAt: 2_000 },
        ],
        'claude/ledger'
      )
    ).toBe('Ledger job migration');
  });

  it('is the branch when no session was found', () => {
    expect(pickAdoptionName([], 'claude/ledger')).toBe('claude/ledger');
  });

  it('is the branch when the newest session has no title', () => {
    expect(
      pickAdoptionName(
        [
          { title: null, lastActivityAt: 3_000 },
          { title: 'Older chat', lastActivityAt: 1_000 },
        ],
        'claude/ledger'
      )
    ).toBe('claude/ledger');
  });

  it('counts a session with no recorded activity as the oldest', () => {
    expect(
      pickAdoptionName(
        [
          { title: 'Undated', lastActivityAt: null },
          { title: 'Dated', lastActivityAt: 1_000 },
        ],
        'claude/ledger'
      )
    ).toBe('Dated');
  });
});
