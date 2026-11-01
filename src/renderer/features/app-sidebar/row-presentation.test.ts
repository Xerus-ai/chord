import { describe, expect, it } from 'vitest';
import {
  makeItem,
  makePullRequest,
  makeSummary,
  makeWorktree,
} from './_testing/row-presentation-fixtures';
import {
  getHoverCardAction,
  getTrailingSlot,
  isCardExpandable,
  resolveItemProviderId,
} from './row-presentation';

describe('getTrailingSlot', () => {
  it('shows the live session count while the item is working', () => {
    expect(getTrailingSlot(makeItem({ bucket: 'working', liveSessionCount: 2 }))).toEqual({
      kind: 'running',
      liveSessionCount: 2,
    });
  });

  it('prefers the running chip over a diff stat', () => {
    expect(
      getTrailingSlot(
        makeItem({ bucket: 'working', liveSessionCount: 1, diffStats: { added: 9, removed: 3 } })
      )
    ).toEqual({ kind: 'running', liveSessionCount: 1 });
  });

  it('shows the diff stat when there is one', () => {
    expect(getTrailingSlot(makeItem({ diffStats: { added: 693, removed: 662 } }))).toEqual({
      kind: 'diff',
      added: 693,
      removed: 662,
    });
    expect(getTrailingSlot(makeItem({ diffStats: { added: 2, removed: 0 } }))).toEqual({
      kind: 'diff',
      added: 2,
      removed: 0,
    });
  });

  it('never renders +0 -0 — an empty diff falls through to the time', () => {
    expect(getTrailingSlot(makeItem({ diffStats: { added: 0, removed: 0 } }))).toEqual({
      kind: 'time',
    });
  });

  it('shows the time when there is nothing else to say', () => {
    expect(getTrailingSlot(makeItem())).toEqual({ kind: 'time' });
  });
});

describe('isCardExpandable', () => {
  it('is false for a single worktree with no live session', () => {
    expect(isCardExpandable(makeSummary())).toBe(false);
  });

  it('is false when no summary has arrived yet', () => {
    expect(isCardExpandable(undefined)).toBe(false);
  });

  it('is true with a second worktree', () => {
    expect(
      isCardExpandable(makeSummary({ worktrees: [makeWorktree(), makeWorktree({ id: 'wt-2' })] }))
    ).toBe(true);
  });

  // Its archived lanes are listed under it, as "Archived (n)".
  it('is true with one worktree and an archived lane', () => {
    expect(isCardExpandable(makeSummary({ archivedLaneCount: 1 }))).toBe(true);
  });

  it('is true with one worktree that has a live session', () => {
    expect(
      isCardExpandable(
        makeSummary({
          worktrees: [
            makeWorktree({
              liveSessions: [
                {
                  sessionId: 's-1',
                  kind: 'chat',
                  title: 'Agent names from other tools',
                  lastActiveAt: 10,
                  providerId: 'claude',
                  subagents: [],
                },
              ],
            }),
          ],
        })
      )
    ).toBe(true);
  });
});

describe('getHoverCardAction — precedence', () => {
  it('offers to review a request when the item needs the user', () => {
    expect(
      getHoverCardAction(
        makeItem({
          needsYou: [{ kind: 'review_requested', prUrl: 'https://github.com/acme/app/pull/1' }],
          bucket: 'idle',
        })
      )
    ).toEqual({ kind: 'open_item', label: 'Review request' });
  });

  it('offers to review a request for the needs_input bucket even with no reasons listed', () => {
    expect(getHoverCardAction(makeItem({ bucket: 'needs_input', needsYou: [] }))).toEqual({
      kind: 'open_item',
      label: 'Review request',
    });
  });

  it('needs-you outranks a failed bucket and a pull request', () => {
    expect(
      getHoverCardAction(
        makeItem({
          bucket: 'failed',
          needsYou: [{ kind: 'mentioned', count: 1 }],
          pullRequest: makePullRequest(),
        })
      )
    ).toEqual({ kind: 'open_item', label: 'Review request' });
  });

  it('offers to view the failure for a failed bucket', () => {
    expect(getHoverCardAction(makeItem({ bucket: 'failed' }))).toEqual({
      kind: 'open_item',
      label: 'View failure',
    });
  });

  it('a failed bucket outranks a pull request', () => {
    expect(
      getHoverCardAction(makeItem({ bucket: 'failed', pullRequest: makePullRequest() }))
    ).toEqual({ kind: 'open_item', label: 'View failure' });
  });

  it('offers to open the pull request when one exists', () => {
    const pr = makePullRequest({ url: 'https://github.com/acme/app/pull/9' });
    expect(getHoverCardAction(makeItem({ pullRequest: pr }))).toEqual({
      kind: 'open_pull_request',
      label: 'Open pull request',
      url: 'https://github.com/acme/app/pull/9',
    });
  });

  it('a pull request outranks a non-zero diff', () => {
    expect(
      getHoverCardAction(
        makeItem({ pullRequest: makePullRequest(), diffStats: { added: 4, removed: 1 } })
      )
    ).toEqual({ kind: 'open_pull_request', label: 'Open pull request', url: expect.any(String) });
  });

  it('offers to review changes for a non-zero diff with no pull request', () => {
    expect(getHoverCardAction(makeItem({ diffStats: { added: 4, removed: 1 } }))).toEqual({
      kind: 'open_item',
      label: 'Review changes',
    });
  });

  it('is null for a zero diff with no pull request and nothing needing the user', () => {
    expect(getHoverCardAction(makeItem({ diffStats: { added: 0, removed: 0 } }))).toBeNull();
  });

  it('is null for a quiet idle item with nothing to act on', () => {
    expect(getHoverCardAction(makeItem())).toBeNull();
  });
});

describe('resolveItemProviderId', () => {
  it('is null without a summary', () => {
    expect(resolveItemProviderId(undefined)).toBeNull();
  });

  it('falls back to the primary worktree when nothing is live', () => {
    expect(
      resolveItemProviderId(
        makeSummary({
          worktrees: [
            makeWorktree({ id: 'wt-2', isPrimary: false, providerId: 'codex' }),
            makeWorktree({ id: 'wt-1', isPrimary: true, providerId: 'claude' }),
          ],
        })
      )
    ).toBe('claude');
  });

  it('prefers the most recently active live session across worktrees', () => {
    expect(
      resolveItemProviderId(
        makeSummary({
          worktrees: [
            makeWorktree({
              id: 'wt-1',
              providerId: 'claude',
              liveSessions: [
                {
                  sessionId: 's-old',
                  kind: 'chat',
                  title: null,
                  lastActiveAt: 10,
                  providerId: 'claude',
                  subagents: [],
                },
              ],
            }),
            makeWorktree({
              id: 'wt-2',
              isPrimary: false,
              providerId: 'codex',
              liveSessions: [
                {
                  sessionId: 's-new',
                  kind: 'chat',
                  title: null,
                  lastActiveAt: 99,
                  providerId: 'codex',
                  subagents: [],
                },
              ],
            }),
          ],
        })
      )
    ).toBe('codex');
  });

  it('is null when neither the live sessions nor the primary worktree know one', () => {
    expect(
      resolveItemProviderId(
        makeSummary({
          worktrees: [
            makeWorktree({
              providerId: null,
              liveSessions: [
                {
                  sessionId: 's-1',
                  kind: 'terminal',
                  title: null,
                  lastActiveAt: 5,
                  providerId: null,
                  subagents: [],
                },
              ],
            }),
          ],
        })
      )
    ).toBeNull();
  });
});
