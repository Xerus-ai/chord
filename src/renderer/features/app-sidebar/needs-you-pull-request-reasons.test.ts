import { describe, expect, it } from 'vitest';
import {
  pullRequestKey,
  type NeedsYouPullRequestRef,
  type NeedsYouPullRequests,
} from '@shared/sidebar-summaries';
import { mergePullRequestReasons } from './needs-you-pull-request-reasons';

function ref(repo: string, number: number): NeedsYouPullRequestRef {
  return {
    key: `${repo}#${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    number,
    repo,
    title: `PR ${number}`,
    author: 'priya',
  };
}

const PRS: NeedsYouPullRequests = {
  reviewRequested: [ref('acme/web', 42)],
  changesRequested: [ref('acme/api', 7)],
};

describe('pullRequestKey', () => {
  it('normalizes casing, trailing path, and slash', () => {
    expect(pullRequestKey('https://github.com/Acme/Web/pull/42/files')).toBe('acme/web#42');
    expect(pullRequestKey('https://github.com/acme/web/pull/42/')).toBe('acme/web#42');
  });

  it('is null for a URL that is not a pull request', () => {
    expect(pullRequestKey('https://github.com/acme/web/issues/42')).toBeNull();
  });
});

describe('mergePullRequestReasons', () => {
  it('adds review requested when the pr_url matches, whatever its casing', () => {
    const prUrl = 'https://github.com/Acme/Web/pull/42';
    expect(mergePullRequestReasons([], prUrl, PRS)).toEqual([{ kind: 'review_requested', prUrl }]);
  });

  it('adds changes requested for the user’s own PR', () => {
    const prUrl = 'https://github.com/acme/api/pull/7';
    expect(mergePullRequestReasons([], prUrl, PRS)).toEqual([{ kind: 'changes_requested', prUrl }]);
  });

  it('adds nothing for an unmatched PR, a missing pr_url, or no PR data', () => {
    const local = [{ kind: 'mentioned' as const, count: 1 }];
    expect(mergePullRequestReasons(local, 'https://github.com/acme/web/pull/1', PRS)).toEqual(
      local
    );
    expect(mergePullRequestReasons(local, null, PRS)).toEqual(local);
    expect(
      mergePullRequestReasons(local, 'https://github.com/acme/web/pull/42', undefined)
    ).toEqual(local);
  });

  it('places review reasons after pending requests and before mentions', () => {
    const prUrl = 'https://github.com/acme/web/pull/42';
    expect(
      mergePullRequestReasons(
        [
          { kind: 'pending_permission', count: 1 },
          { kind: 'mentioned', count: 2 },
        ],
        prUrl,
        PRS
      )
    ).toEqual([
      { kind: 'pending_permission', count: 1 },
      { kind: 'review_requested', prUrl },
      { kind: 'mentioned', count: 2 },
    ]);
  });
});
