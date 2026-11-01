import { describe, expect, it } from 'vitest';
import { deriveBandState, type BandStateInput } from './band-state';

const QUIET: BandStateInput = {
  conflictCount: 0,
  changedCount: 0,
  aheadCount: 0,
  publication: 'published',
  prState: null,
  failingCheckCount: 0,
  runningCheckCount: 0,
  reviewState: null,
  canMerge: false,
};

/**
 * The band's publication line comes from where Push sends the branch, read by
 * git — not from "some commit in the log is on a remote". A lane forked from
 * origin/main shares main's commits, so that guess read every new lane as
 * "Pushed · no pull request" (devstation-dh2).
 */
describe('deriveBandState publication', () => {
  it('a lane branch never pushed reads Not published', () => {
    expect(deriveBandState({ ...QUIET, publication: 'unpublished' }).text).toBe('Not published');
  });

  it('a pushed branch with no pull request reads Pushed · no pull request', () => {
    expect(deriveBandState(QUIET).text).toBe('Pushed · no pull request');
  });

  it('a repository with no remote says so instead of counting commits to push', () => {
    const state = deriveBandState({ ...QUIET, publication: 'no_remote', aheadCount: 4 });
    expect(state).toEqual({
      glyph: 'branch',
      signal: 'neutral',
      text: 'No remote',
      short: 'No remote',
    });
  });

  it('uncommitted work still outranks a missing remote', () => {
    const state = deriveBandState({ ...QUIET, publication: 'no_remote', changedCount: 2 });
    expect(state.text).toBe('2 uncommitted files');
  });

  it('a detached checkout reads Detached, not Not published', () => {
    expect(deriveBandState({ ...QUIET, publication: 'detached' }).text).toBe('Detached HEAD');
  });

  it('while the branch is being read the band says it is checking, not a guess', () => {
    expect(deriveBandState({ ...QUIET, publication: null }).text).toBe('Checking the branch…');
  });

  it('commits to push still lead on an unpublished branch with work', () => {
    expect(deriveBandState({ ...QUIET, publication: 'unpublished', aheadCount: 2 }).text).toBe(
      '2 commits to push'
    );
  });
});
