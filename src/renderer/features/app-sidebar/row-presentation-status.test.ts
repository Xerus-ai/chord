import { describe, expect, it } from 'vitest';
import { makeItem, makePullRequest } from './_testing/row-presentation-fixtures';
import { capitalizeStatusWord, getGitGlyph, getStatusWord } from './row-presentation';

describe('getGitGlyph', () => {
  it('shows a plain branch for an item with no pull request', () => {
    expect(getGitGlyph(makeItem())).toEqual({ glyph: 'branch', signal: 'neutral' });
  });

  it('shows an open pull request for review or approval states', () => {
    for (const state of ['in_review', 'ready_to_merge', 'changes_requested'] as const) {
      expect(getGitGlyph(makeItem({ pullRequest: makePullRequest({ state }) }))).toEqual({
        glyph: 'pull_request',
        signal: 'success',
      });
    }
  });

  it('shows a conflict glyph for a conflicting pull request', () => {
    expect(getGitGlyph(makeItem({ pullRequest: makePullRequest({ state: 'conflicts' }) }))).toEqual(
      { glyph: 'conflict', signal: 'warning' }
    );
  });

  it('shows a merged glyph in the merged tone', () => {
    expect(getGitGlyph(makeItem({ pullRequest: makePullRequest({ state: 'merged' }) }))).toEqual({
      glyph: 'merged',
      signal: 'merged',
    });
  });

  it('shows a closed glyph for a closed pull request', () => {
    expect(getGitGlyph(makeItem({ pullRequest: makePullRequest({ state: 'closed' }) }))).toEqual({
      glyph: 'closed',
      signal: 'danger',
    });
  });

  it('shows a draft glyph, untinted, for a draft pull request', () => {
    expect(getGitGlyph(makeItem({ pullRequest: makePullRequest({ state: 'draft' }) }))).toEqual({
      glyph: 'draft',
      signal: 'neutral',
    });
  });
});

describe('getStatusWord — the agent state wins', () => {
  it('reports the bucket word for needs input, failed and working', () => {
    expect(getStatusWord(makeItem({ bucket: 'needs_input' }))).toEqual({
      word: 'Waiting for you',
      signal: 'warning',
    });
    expect(getStatusWord(makeItem({ bucket: 'failed' }))).toEqual({
      word: 'Failed',
      signal: 'danger',
    });
    expect(getStatusWord(makeItem({ bucket: 'working' }))).toEqual({
      word: 'Working',
      signal: 'running',
    });
  });

  it('outranks even a conflicting pull request', () => {
    const item = makeItem({
      bucket: 'working',
      pullRequest: makePullRequest({ state: 'conflicts' }),
    });
    expect(getStatusWord(item)).toEqual({ word: 'Working', signal: 'running' });
  });
});

describe('getStatusWord — else the pull request state', () => {
  it('is null for a quiet item with no pull request', () => {
    expect(getStatusWord(makeItem({ bucket: 'idle' }))).toBeNull();
    expect(getStatusWord(makeItem({ bucket: 'ready_to_review' }))).toBeNull();
    expect(getStatusWord(makeItem({ bucket: 'done' }))).toBeNull();
  });

  it('reports merge conflicts first', () => {
    expect(
      getStatusWord(makeItem({ pullRequest: makePullRequest({ state: 'conflicts' }) }))
    ).toEqual({ word: 'Merge conflicts', signal: 'warning' });
  });

  it('reports a merged pull request in the merged tone', () => {
    expect(getStatusWord(makeItem({ pullRequest: makePullRequest({ state: 'merged' }) }))).toEqual({
      word: 'Merged',
      signal: 'merged',
    });
  });

  it('reports requested changes', () => {
    expect(
      getStatusWord(makeItem({ pullRequest: makePullRequest({ state: 'changes_requested' }) }))
    ).toEqual({ word: 'Changes requested', signal: 'warning' });
  });

  it('reports an approved pull request with green checks as ready to merge', () => {
    expect(
      getStatusWord(
        makeItem({ pullRequest: makePullRequest({ state: 'ready_to_merge', checks: 'passing' }) })
      )
    ).toEqual({ word: 'Ready to merge', signal: 'success' });
  });

  it('reports failed checks over an in-review or approved state', () => {
    expect(
      getStatusWord(
        makeItem({ pullRequest: makePullRequest({ state: 'in_review', checks: 'failing' }) })
      )
    ).toEqual({ word: 'Checks failed', signal: 'danger' });
    expect(
      getStatusWord(
        makeItem({ pullRequest: makePullRequest({ state: 'ready_to_merge', checks: 'failing' }) })
      )
    ).toEqual({ word: 'Checks failed', signal: 'danger' });
  });

  it('reports a draft pull request, and failed checks before draft', () => {
    expect(getStatusWord(makeItem({ pullRequest: makePullRequest({ state: 'draft' }) }))).toEqual({
      word: 'Draft',
      signal: 'neutral',
    });
    expect(
      getStatusWord(
        makeItem({ pullRequest: makePullRequest({ state: 'draft', checks: 'failing' }) })
      )
    ).toEqual({ word: 'Checks failed', signal: 'danger' });
  });

  it('reports in review while checks are pending or absent', () => {
    for (const checks of ['pending', null] as const) {
      expect(
        getStatusWord(makeItem({ pullRequest: makePullRequest({ state: 'in_review', checks }) }))
      ).toEqual({ word: 'In review', signal: 'neutral' });
    }
  });

  it('says nothing about a closed pull request — the glyph already does', () => {
    expect(
      getStatusWord(makeItem({ pullRequest: makePullRequest({ state: 'closed' }) }))
    ).toBeNull();
  });
});

describe('capitalizeStatusWord', () => {
  it('sentence-cases the lower-case status-dot vocabulary', () => {
    expect(capitalizeStatusWord('waiting for you')).toBe('Waiting for you');
    expect(capitalizeStatusWord('done')).toBe('Done');
  });

  it('leaves an already-capitalised word alone', () => {
    expect(capitalizeStatusWord('Working')).toBe('Working');
  });
});
