import { describe, expect, it } from 'vitest';
import type { BranchPick, PullRequestPick } from '@shared/create-from';
import { err, ok } from '@shared/result';
import type { Issue } from '@shared/tasks';
import { viewBranchesTab, viewIssuesTab, viewPullRequestsTab } from './create-from-tabs';

/**
 * What each tab of Create from… shows (plan §Phase 3 slice 2): its rows, the
 * search within it, and a real empty or not-connected state — never sample
 * data, and never an empty list standing in for a failure.
 */

const BRANCHES: BranchPick[] = [
  {
    name: 'feat/login',
    source: 'local',
    remote: null,
    localBranch: 'feat/login',
    tracking: null,
    holder: null,
  },
  {
    name: 'main',
    source: 'local',
    remote: null,
    localBranch: 'main',
    tracking: null,
    holder: { kind: 'checkout', path: 'C:\\api' },
  },
  {
    name: 'upstream/feat/Webhooks',
    source: 'remote',
    remote: 'upstream',
    localBranch: 'feat/Webhooks',
    tracking: { remote: 'upstream', branch: 'feat/Webhooks' },
    holder: null,
  },
];

const PULL: PullRequestPick = {
  owner: 'acme',
  repo: 'api',
  number: 12,
  title: 'Retry webhooks',
  url: 'https://github.com/acme/api/pull/12',
  authorLogin: 'alice',
  isDraft: false,
};

const GITHUB_ISSUE: Issue = {
  provider: 'github',
  identifier: '#12',
  title: 'Retry failed webhooks',
  url: 'https://github.com/acme/api/issues/12',
};
const LINEAR_ISSUE: Issue = {
  provider: 'linear',
  identifier: 'ENG-42',
  title: 'Fix login redirect',
  url: 'https://linear.app/acme/issue/ENG-42/fix-login-redirect',
};

describe('viewBranchesTab', () => {
  it('is loading until the listing answers', () => {
    expect(viewBranchesTab({ result: null, query: '' })).toEqual({ status: 'loading' });
  });

  it('lists every branch, held ones included, when nothing is typed', () => {
    expect(viewBranchesTab({ result: ok(BRANCHES), query: '  ' })).toEqual({
      status: 'rows',
      rows: BRANCHES,
    });
  });

  it('searches branch names, ignoring case', () => {
    expect(viewBranchesTab({ result: ok(BRANCHES), query: 'webhooks' })).toEqual({
      status: 'rows',
      rows: [BRANCHES[2]],
    });
    expect(viewBranchesTab({ result: ok(BRANCHES), query: 'FEAT/' })).toEqual({
      status: 'rows',
      rows: [BRANCHES[0], BRANCHES[2]],
    });
  });

  it('says when no branch matches, quoting the search', () => {
    const view = viewBranchesTab({ result: ok(BRANCHES), query: 'nope' });

    expect(view.status).toBe('empty');
    if (view.status === 'empty') expect(view.message).toContain('nope');
  });

  it('says when the repository has no branches at all', () => {
    const view = viewBranchesTab({ result: ok([]), query: '' });

    expect(view.status).toBe('empty');
    if (view.status === 'empty') expect(view.message).toMatch(/no branches/i);
  });

  it('shows why the listing failed', () => {
    expect(
      viewBranchesTab({
        result: err({ type: 'no_repo', message: 'Repository repo-9 was not found.' }),
        query: '',
      })
    ).toEqual({ status: 'error', message: 'Repository repo-9 was not found.' });
  });
});

describe('viewPullRequestsTab', () => {
  it('is loading until GitHub answers', () => {
    expect(viewPullRequestsTab({ result: null, query: '' })).toEqual({ status: 'loading' });
  });

  it("lists the repository's open pull requests", () => {
    expect(viewPullRequestsTab({ result: ok([PULL]), query: '' })).toEqual({
      status: 'rows',
      rows: [PULL],
    });
  });

  it('says a repository with no GitHub remote has no pull requests to pick', () => {
    const view = viewPullRequestsTab({
      result: err({
        type: 'no_github_remote',
        message: 'No remote of this repository is on GitHub.',
      }),
      query: '',
    });

    expect(view.status).toBe('empty');
    if (view.status === 'empty') expect(view.message).toMatch(/no GitHub remote/);
  });

  it("says GitHub isn't connected, and where to connect it", () => {
    const view = viewPullRequestsTab({
      result: err({ type: 'not_connected', message: 'GitHub is not connected.' }),
      query: '',
    });

    expect(view.status).toBe('empty');
    if (view.status === 'empty') {
      expect(view.message).toMatch(/GitHub isn't connected/);
      expect(view.message).toContain('Settings › Integrations');
    }
  });

  it('says there are no open pull requests, or none matching the search', () => {
    const none = viewPullRequestsTab({ result: ok([]), query: '' });
    const noMatch = viewPullRequestsTab({ result: ok([]), query: 'webhooks' });

    expect(none.status).toBe('empty');
    if (none.status === 'empty') expect(none.message).toMatch(/no open pull requests/i);
    expect(noMatch.status).toBe('empty');
    if (noMatch.status === 'empty') expect(noMatch.message).toContain('webhooks');
  });

  it('shows what GitHub said when the listing failed', () => {
    expect(
      viewPullRequestsTab({ result: err({ type: 'error', message: 'Server Error' }), query: '' })
    ).toEqual({ status: 'error', message: 'Server Error' });
  });
});

describe('viewIssuesTab', () => {
  it('is loading while the connections are checked', () => {
    expect(viewIssuesTab({ sources: null, query: '' })).toEqual({
      view: { status: 'loading' },
      notices: [],
    });
  });

  it('says no issue tracker is connected, and where to connect one', () => {
    const { view, notices } = viewIssuesTab({
      sources: [
        { provider: 'github', status: 'not_connected' },
        { provider: 'linear', status: 'not_connected' },
        { provider: 'jira', status: 'not_connected' },
      ],
      query: '',
    });

    expect(view.status).toBe('empty');
    if (view.status === 'empty') {
      expect(view.message).toMatch(/No issue tracker is connected/);
      expect(view.message).toContain('Settings › Integrations');
    }
    expect(notices).toEqual([]);
  });

  it('lists the issues of every connected tracker, GitHub first', () => {
    expect(
      viewIssuesTab({
        sources: [
          { provider: 'github', status: 'ready', issues: [GITHUB_ISSUE] },
          { provider: 'linear', status: 'ready', issues: [LINEAR_ISSUE] },
          { provider: 'jira', status: 'not_connected' },
        ],
        query: '',
      })
    ).toEqual({ view: { status: 'rows', rows: [GITHUB_ISSUE, LINEAR_ISSUE] }, notices: [] });
  });

  it("names a tracker that couldn't list, next to the ones that could", () => {
    const { view, notices } = viewIssuesTab({
      sources: [
        { provider: 'github', status: 'error', message: 'Bad credentials' },
        { provider: 'linear', status: 'ready', issues: [LINEAR_ISSUE] },
        { provider: 'jira', status: 'not_connected' },
      ],
      query: '',
    });

    expect(view).toEqual({ status: 'rows', rows: [LINEAR_ISSUE] });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('GitHub');
    expect(notices[0]).toContain('Bad credentials');
  });

  it('says GitHub has no issues to offer for a repository with no GitHub remote', () => {
    const { view, notices } = viewIssuesTab({
      sources: [
        { provider: 'github', status: 'no_repository' },
        { provider: 'linear', status: 'not_connected' },
        { provider: 'jira', status: 'not_connected' },
      ],
      query: '',
    });

    expect(view.status).toBe('empty');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/no GitHub remote/);
  });

  it('keeps loading while a connected tracker is still listing and none has rows', () => {
    expect(
      viewIssuesTab({
        sources: [
          { provider: 'github', status: 'loading' },
          { provider: 'linear', status: 'ready', issues: [] },
          { provider: 'jira', status: 'not_connected' },
        ],
        query: '',
      }).view
    ).toEqual({ status: 'loading' });
  });

  it('says there are no open issues, or none matching the search', () => {
    const sources = [
      { provider: 'github' as const, status: 'ready' as const, issues: [] },
      { provider: 'linear' as const, status: 'not_connected' as const },
      { provider: 'jira' as const, status: 'not_connected' as const },
    ];
    const none = viewIssuesTab({ sources, query: '' }).view;
    const noMatch = viewIssuesTab({ sources, query: 'webhooks' }).view;

    expect(none.status).toBe('empty');
    if (none.status === 'empty') expect(none.message).toMatch(/no open issues/i);
    expect(noMatch.status).toBe('empty');
    if (noMatch.status === 'empty') expect(noMatch.message).toContain('webhooks');
  });
});
