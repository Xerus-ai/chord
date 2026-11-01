import { describe, expect, it } from 'vitest';
import type { NeedsYouPullRequestRef, SidebarPullRequestSummary } from '@shared/sidebar-summaries';
import type { SidebarItem } from '@renderer/features/app-sidebar/sidebar-projection';
import {
  buildStatSegments,
  chooseCardSignal,
  countMergedSince,
  resolveCardBranch,
  resolveCardProviderId,
  sectionDashboardItems,
  selectReviewRequests,
} from './dashboard-projection';

function makeItem(overrides: Partial<SidebarItem> = {}): SidebarItem {
  return {
    id: 'wi-1',
    name: 'Auth JWT migration',
    repoId: 'repo-a',
    repoLabel: 'devstation',
    branchName: 'feat/auth-core',
    bucket: 'idle',
    updatedAt: 1_800_000_000,
    createdAt: 1_799_000_000,
    ownership: 'mine',
    owner: null,
    sharedArtifacts: null,
    diffStats: null,
    pullRequestUrl: null,
    pullRequest: null,
    providerId: null,
    devServerUrl: null,
    worktreeCount: 1,
    liveSessionCount: 0,
    needsYou: [],
    unread: false,
    provisionStatus: 'ready',
    ownedByAnotherAccount: false,
    repoHint: null,
    compareCue: null,
    ...overrides,
  };
}

function makePullRequest(
  overrides: Partial<SidebarPullRequestSummary> = {}
): SidebarPullRequestSummary {
  return {
    url: 'https://github.com/acme/web/pull/42',
    number: 42,
    state: 'in_review',
    checks: null,
    ...overrides,
  };
}

function makeRef(repo: string, number: number): NeedsYouPullRequestRef {
  return {
    key: `${repo}#${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    number,
    repo,
    title: `PR ${number}`,
    author: 'priya',
  };
}

describe('sectionDashboardItems', () => {
  it('puts each item in exactly one section: needs you, then running, then the rest', () => {
    const blocked = makeItem({
      id: 'blocked',
      bucket: 'working',
      needsYou: [{ kind: 'pending_plan', count: 1 }],
    });
    const waiting = makeItem({ id: 'waiting', bucket: 'needs_input' });
    const running = makeItem({ id: 'running', bucket: 'working', liveSessionCount: 1 });
    const quiet = makeItem({ id: 'quiet', bucket: 'idle' });
    const failed = makeItem({ id: 'failed', bucket: 'failed' });

    const sections = sectionDashboardItems([blocked, waiting, running, quiet, failed]);

    expect(sections.needsYou.map((i) => i.id)).toEqual(['blocked', 'waiting']);
    expect(sections.running.map((i) => i.id)).toEqual(['running']);
    expect(sections.pickUp.map((i) => i.id)).toEqual(['quiet', 'failed']);
  });

  // An idle session held in memory is not work happening — only a streaming
  // turn is "running now".
  it('does not call an item running just because a session is held open', () => {
    const idleButOpen = makeItem({ bucket: 'idle', liveSessionCount: 2 });
    expect(sectionDashboardItems([idleButOpen]).running).toEqual([]);
  });

  it('keeps the input order within a section', () => {
    const a = makeItem({ id: 'a', bucket: 'idle' });
    const b = makeItem({ id: 'b', bucket: 'idle' });
    expect(sectionDashboardItems([b, a]).pickUp.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('selectReviewRequests', () => {
  it("drops requests for PRs that are already one of the user's work items", () => {
    const own = makeItem({ pullRequestUrl: 'https://github.com/Acme/Web/pull/42/' });
    const refs = [makeRef('acme/web', 42), makeRef('acme/api', 7)];

    expect(selectReviewRequests(refs, [own]).map((r) => r.key)).toEqual(['acme/api#7']);
  });

  it('returns nothing when GitHub data is unavailable', () => {
    expect(selectReviewRequests(undefined, [makeItem()])).toEqual([]);
  });
});

describe('chooseCardSignal', () => {
  it('leads with what the user is asked for, tinted as a warning', () => {
    const item = makeItem({ bucket: 'working', needsYou: [{ kind: 'pending_plan', count: 1 }] });
    expect(chooseCardSignal(item)).toEqual({ label: 'Plan to approve', signal: 'warning' });
  });

  // A mention is a reason to look, not a blocked agent.
  it('keeps mention-only reasons neutral', () => {
    const item = makeItem({ needsYou: [{ kind: 'mentioned', count: 2 }] });
    expect(chooseCardSignal(item)).toEqual({ label: 'Mentioned you 2×', signal: 'neutral' });
  });

  it("falls back to the sidebar's status word", () => {
    expect(chooseCardSignal(makeItem({ bucket: 'working' }))?.signal).toBe('running');
    expect(
      chooseCardSignal(makeItem({ pullRequest: makePullRequest({ checks: 'failing' }) }))
    ).toEqual({ label: 'Checks failed', signal: 'danger' });
  });

  it('says nothing for an item at rest', () => {
    expect(chooseCardSignal(makeItem({ bucket: 'idle' }))).toBeNull();
  });
});

describe('countMergedSince', () => {
  const now = 1_800_000_000;
  const week = 7 * 24 * 60 * 60;

  it('counts done items with a PR updated within the window', () => {
    const rows = [
      { status: 'done', prNumber: 1, updatedAt: now - 60 },
      { status: 'done', prNumber: 2, updatedAt: now - week - 1 },
      { status: 'done', prNumber: null, updatedAt: now - 60 },
      { status: 'active', prNumber: 3, updatedAt: now - 60 },
    ];
    expect(countMergedSince(rows, now - week)).toBe(1);
  });
});

describe('buildStatSegments', () => {
  it('omits zero and unknown counts rather than printing them', () => {
    expect(buildStatSegments({ active: 5, needYou: 0, running: null, mergedThisWeek: 3 })).toEqual([
      { count: 5, label: 'active', signal: 'neutral' },
      { count: 3, label: 'merged this week', signal: 'neutral' },
    ]);
  });

  it('tints need-you and running counts', () => {
    expect(
      buildStatSegments({ active: 2, needYou: 1, running: 1, mergedThisWeek: 0 }).map(
        (s) => s.signal
      )
    ).toEqual(['neutral', 'warning', 'running']);
  });
});

describe('resolveCardBranch', () => {
  it("prefers the work item's own branch", () => {
    expect(resolveCardBranch(makeItem({ branchName: 'feat/a' }), 'main')).toBe('feat/a');
  });

  // Working straight in the repo leaves branch_name null; the card still says
  // which branch the checkout is on, as git reports it.
  it('falls back to the branch the checkout is on', () => {
    expect(resolveCardBranch(makeItem({ branchName: null }), 'main')).toBe('main');
  });

  it('is null when neither is known (detached HEAD, summary not loaded)', () => {
    expect(resolveCardBranch(makeItem({ branchName: null }), null)).toBeNull();
  });
});

describe('resolveCardProviderId', () => {
  it('prefers the provider of the session actually in use', () => {
    expect(resolveCardProviderId(makeItem({ providerId: 'codex' }), 'claude')).toBe('codex');
  });

  it('falls back to the agent the item was created with', () => {
    expect(resolveCardProviderId(makeItem({ providerId: null }), 'claude')).toBe('claude');
  });

  it('is null when the item names no agent at all', () => {
    expect(resolveCardProviderId(makeItem({ providerId: null }), null)).toBeNull();
  });
});
