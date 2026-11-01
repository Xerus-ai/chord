import { describe, expect, it } from 'vitest';
import { toPullRequestRef } from './sidebar-summaries';

describe('toPullRequestRef', () => {
  it('keeps what a review row prints, keyed the way work items are matched', () => {
    expect(
      toPullRequestRef({
        url: 'https://github.com/Acme/Web/pull/263',
        number: 263,
        title: 'Paginate the activity feed',
        repository: { nameWithOwner: 'Acme/Web' },
        author: { login: 'priya' },
      })
    ).toEqual({
      key: 'acme/web#263',
      url: 'https://github.com/Acme/Web/pull/263',
      number: 263,
      title: 'Paginate the activity feed',
      repo: 'Acme/Web',
      author: 'priya',
    });
  });

  // A deleted GitHub account comes back as a null author.
  it('keeps a PR whose author is gone, with no author', () => {
    expect(
      toPullRequestRef({
        url: 'https://github.com/acme/web/pull/1',
        number: 1,
        title: 'Old change',
        repository: { nameWithOwner: 'acme/web' },
        author: null,
      })?.author
    ).toBeNull();
  });

  // Search is `type: ISSUE`; a node that is not a PullRequest has none of
  // the fragment's fields.
  it('skips a search node that is not a pull request', () => {
    expect(toPullRequestRef({})).toBeNull();
    expect(
      toPullRequestRef({
        url: 'https://github.com/acme/web/issues/5',
        number: 5,
        title: 'An issue',
        repository: { nameWithOwner: 'acme/web' },
        author: { login: 'kami' },
      })
    ).toBeNull();
  });
});
