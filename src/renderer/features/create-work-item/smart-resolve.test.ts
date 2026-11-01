import { describe, expect, it } from 'vitest';
import { provisionalName, resolveSmartField, toIssueRef, toPullRequestRef } from './smart-resolve';

describe('resolveSmartField', () => {
  it('reads nothing out of an empty field', () => {
    expect(resolveSmartField('')).toBeNull();
    expect(resolveSmartField('   ')).toBeNull();
  });

  it('recognises a GitHub issue and a GitHub pull request', () => {
    expect(resolveSmartField('https://github.com/acme/api/issues/1234')).toEqual({
      kind: 'github',
      owner: 'acme',
      repo: 'api',
      type: 'issue',
      number: 1234,
      url: 'https://github.com/acme/api/issues/1234',
    });
    expect(resolveSmartField('https://github.com/acme/api/pull/7')).toMatchObject({
      kind: 'github',
      type: 'pull',
      number: 7,
    });
  });

  it('survives a trailing path on a GitHub URL', () => {
    expect(resolveSmartField('https://github.com/acme/api/pull/7/files')).toMatchObject({
      kind: 'github',
      number: 7,
    });
  });

  it('recognises a Linear URL and upper-cases the key', () => {
    expect(resolveSmartField('https://linear.app/acme/issue/eng-42/fix-the-thing')).toMatchObject({
      kind: 'linear',
      issueKey: 'ENG-42',
    });
  });

  it('recognises a Jira URL and a bare Jira key', () => {
    expect(resolveSmartField('https://acme.atlassian.net/browse/PLAT-9')).toMatchObject({
      kind: 'jira',
      issueKey: 'PLAT-9',
    });
    expect(resolveSmartField('PLAT-9')).toEqual({ kind: 'jira', issueKey: 'PLAT-9', url: null });
  });

  it('never reads typed text as a branch to reuse — a slash path is a name like any other', () => {
    // Reusing a branch is an explicit pick (the Create from… picker), never a
    // guess from text: `main` and `feat/auth-core` both name a new lane.
    expect(resolveSmartField('feat/auth-core')).toEqual({ kind: 'name', name: 'feat/auth-core' });
    expect(resolveSmartField('users/raghav/spike.1')).toEqual({
      kind: 'name',
      name: 'users/raghav/spike.1',
    });
    expect(resolveSmartField('main')).toEqual({ kind: 'name', name: 'main' });
  });

  it('treats anything else as a name', () => {
    expect(resolveSmartField('Auth JWT migration')).toEqual({
      kind: 'name',
      name: 'Auth JWT migration',
    });
    expect(resolveSmartField('auth-core')).toEqual({ kind: 'name', name: 'auth-core' });
    expect(resolveSmartField('plat-9')).toEqual({ kind: 'name', name: 'plat-9' });
  });

  it('trims before deciding', () => {
    expect(resolveSmartField('  feat/x  ')).toEqual({ kind: 'name', name: 'feat/x' });
  });
});

describe('provisionalName', () => {
  it('names a work item before any lookup answers', () => {
    expect(provisionalName(resolveSmartField('https://github.com/a/b/issues/5')!)).toBe('#5');
    expect(provisionalName(resolveSmartField('PLAT-9')!)).toBe('PLAT-9');
    expect(provisionalName(resolveSmartField('feat/x')!)).toBe('feat/x');
    expect(provisionalName(resolveSmartField('Ship it')!)).toBe('Ship it');
  });
});

describe('toIssueRef', () => {
  it('looks a GitHub issue up in the owner/repo its URL names', () => {
    expect(toIssueRef(resolveSmartField('https://github.com/cli/cli/issues/2')!)).toEqual({
      provider: 'github',
      owner: 'cli',
      repo: 'cli',
      number: 2,
    });
  });

  it('looks Linear and Jira tickets up by their key', () => {
    expect(toIssueRef(resolveSmartField('https://linear.app/acme/issue/eng-42/x')!)).toEqual({
      provider: 'linear',
      key: 'ENG-42',
    });
    expect(toIssueRef(resolveSmartField('https://acme.atlassian.net/browse/PLAT-9')!)).toEqual({
      provider: 'jira',
      key: 'PLAT-9',
    });
    expect(toIssueRef(resolveSmartField('PLAT-9')!)).toEqual({ provider: 'jira', key: 'PLAT-9' });
  });

  it('has nothing to look up for a pull request or a plain name', () => {
    // A PR URL is a pick of its head branch, not a ticket.
    expect(toIssueRef(resolveSmartField('https://github.com/cli/cli/pull/14577')!)).toBeNull();
    expect(toIssueRef(resolveSmartField('Ship it')!)).toBeNull();
  });
});

describe('toPullRequestRef', () => {
  it('reads a pasted PR URL as the PR to check out', () => {
    expect(
      toPullRequestRef(resolveSmartField('https://github.com/cli/cli/pull/14577/files')!)
    ).toEqual({ owner: 'cli', repo: 'cli', number: 14577 });
  });

  it('is null for anything that is not a pull request', () => {
    expect(toPullRequestRef(resolveSmartField('https://github.com/cli/cli/issues/2')!)).toBeNull();
    expect(toPullRequestRef(resolveSmartField('PLAT-9')!)).toBeNull();
    expect(toPullRequestRef(resolveSmartField('Ship it')!)).toBeNull();
  });
});
