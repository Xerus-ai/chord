import { describe, expect, it } from 'vitest';
import {
  parseSessionQuery,
  sessionMatchesQuery,
  type SessionFilterCandidate,
} from './session-filter';

function candidate(overrides: Partial<SessionFilterCandidate> = {}): SessionFilterCandidate {
  return {
    title: 'Redesign the right rail',
    preview: 'Move the Share button back to the topbar',
    branch: 'redesining-work-item',
    model: 'claude-opus-4-6',
    ...overrides,
  };
}

function matches(query: string, overrides: Partial<SessionFilterCandidate> = {}): boolean {
  return sessionMatchesQuery(candidate(overrides), parseSessionQuery(query));
}

describe('parseSessionQuery', () => {
  it('splits free terms on whitespace and lowercases them', () => {
    expect(parseSessionQuery('  Rail   REDESIGN ')).toEqual({
      terms: ['rail', 'redesign'],
      branchTerms: [],
    });
  });

  it('pulls branch: out of the free terms', () => {
    expect(parseSessionQuery('share branch:redesining')).toEqual({
      terms: ['share'],
      branchTerms: ['redesining'],
    });
  });

  it('ignores a bare prefix with no value, rather than matching everything', () => {
    expect(parseSessionQuery('branch:')).toEqual({ terms: [], branchTerms: [] });
  });
});

describe('sessionMatchesQuery', () => {
  it('an empty query matches every session', () => {
    expect(matches('')).toBe(true);
    expect(matches('   ')).toBe(true);
  });

  it('matches the title, case-insensitively', () => {
    // Title is 'Redesign the right rail', so both terms are present.
    expect(matches('RIGHT RAIL')).toBe(true);
    expect(matches('rail')).toBe(true);
    expect(matches('Redesign')).toBe(true);
  });

  it('matches the preview line, which is what identifies an untitled session', () => {
    expect(matches('topbar')).toBe(true);
    expect(matches('topbar', { title: null })).toBe(true);
  });

  it('matches the model, so one agent’s sessions can be picked out', () => {
    expect(matches('opus')).toBe(true);
  });

  // AND, not OR: narrowing is the whole point of typing a second word.
  it('requires every free term to match something', () => {
    expect(matches('rail topbar')).toBe(true);
    expect(matches('rail nonsense')).toBe(false);
  });

  it('a term may not match across two fields at once', () => {
    expect(matches('rail', { title: 'ra', preview: 'il', model: null })).toBe(false);
  });

  it('branch: restricts to the worktree, case-insensitively', () => {
    expect(matches('branch:REDESINING')).toBe(true);
    expect(matches('branch:master')).toBe(false);
  });

  it('a session with no branch never satisfies a branch: term', () => {
    expect(matches('branch:redesining', { branch: null })).toBe(false);
  });

  // The prefix is its own field: typing a branch name as a free term should
  // not silently search the branch, or `branch:` would be decoration.
  it('a free term does not match the branch', () => {
    expect(matches('redesining', { title: null, preview: null, model: null })).toBe(false);
  });

  it('combines a free term with branch:', () => {
    expect(matches('topbar branch:redesining')).toBe(true);
    expect(matches('topbar branch:master')).toBe(false);
    expect(matches('nonsense branch:redesining')).toBe(false);
  });

  it('a session with nothing to search matches only an empty query', () => {
    const bare = { title: null, preview: null, model: null };
    expect(matches('', bare)).toBe(true);
    expect(matches('anything', bare)).toBe(false);
  });
});
