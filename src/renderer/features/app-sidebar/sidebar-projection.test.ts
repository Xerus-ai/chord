import { describe, expect, it } from 'vitest';
import type { WorkItemStatusBucket } from '@shared/work-item-status';
import { DEFAULT_SIDEBAR_OPTIONS, type SidebarOptions } from './sidebar-options-model';
import {
  normalizeSidebarView,
  projectSidebar,
  type SidebarItem,
  type SidebarView,
} from './sidebar-projection';

const NOW = 1_800_000_000;

function makeItem(overrides: Partial<SidebarItem> & { id: string }): SidebarItem {
  return {
    name: overrides.id,
    repoId: 'repo-a',
    repoLabel: 'xerus-backend',
    branchName: 'feat/x',
    bucket: 'idle' as WorkItemStatusBucket,
    updatedAt: NOW - 60,
    createdAt: NOW - 3600,
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

function project(
  items: SidebarItem[],
  view: SidebarView = 'repo',
  options: Partial<SidebarOptions> = {},
  pinnedIds: string[] = []
) {
  return projectSidebar({
    items,
    pinnedIds,
    options: { ...DEFAULT_SIDEBAR_OPTIONS, ...options },
    view,
    nowSeconds: NOW,
  });
}

/** Every id the projection renders, top to bottom. */
function renderedIds(result: ReturnType<typeof project>): string[] {
  return [...result.pinned, ...result.groups.flatMap((group) => group.items)].map((i) => i.id);
}

describe('projectSidebar — every item appears exactly once', () => {
  const items = [
    makeItem({ id: 'blocked', bucket: 'needs_input' }),
    makeItem({ id: 'mentioned', needsYou: [{ kind: 'mentioned', count: 2 }] }),
    makeItem({ id: 'theirs', ownership: 'team', owner: { name: 'Kai Ahn', avatarUrl: null } }),
    makeItem({ id: 'finished', bucket: 'done' }),
    makeItem({ id: 'plain' }),
  ];

  it('renders each work item once in repo view', () => {
    const ids = renderedIds(project(items, 'repo'));
    expect([...ids].sort()).toEqual(['blocked', 'finished', 'mentioned', 'plain', 'theirs']);
  });

  it('renders each work item once in status view', () => {
    const ids = renderedIds(project(items, 'status'));
    expect([...ids].sort()).toEqual(['blocked', 'finished', 'mentioned', 'plain', 'theirs']);
  });

  it('renders each work item once when some of them are pinned', () => {
    const ids = renderedIds(project(items, 'status', {}, ['theirs', 'blocked']));
    expect([...ids].sort()).toEqual(['blocked', 'finished', 'mentioned', 'plain', 'theirs']);
  });
});

describe('projectSidebar — row facts survive the projection', () => {
  it('carries the PR summary and provider through to the grouped item', () => {
    const pullRequest = {
      url: 'https://github.com/acme/app/pull/214',
      number: 214,
      state: 'ready_to_merge' as const,
      checks: 'passing' as const,
    };
    const result = project([
      makeItem({ id: 'a', pullRequest, providerId: 'claude', pullRequestUrl: pullRequest.url }),
    ]);
    expect(result.groups[0].items[0].pullRequest).toEqual(pullRequest);
    expect(result.groups[0].items[0].providerId).toBe('claude');
  });
});

describe('projectSidebar — pinned', () => {
  it('moves a pinned item out of its group and keeps the stored order', () => {
    const result = project(
      [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })],
      'repo',
      {},
      ['c', 'a']
    );
    expect(result.pinned.map((i) => i.id)).toEqual(['c', 'a']);
    expect(result.groups.flatMap((g) => g.items).map((i) => i.id)).toEqual(['b']);
  });

  it('ignores a pinned id whose work item is gone or filtered away', () => {
    const result = project([makeItem({ id: 'a' })], 'repo', {}, ['ghost', 'a']);
    expect(result.pinned.map((i) => i.id)).toEqual(['a']);
  });

  it('keeps a pinned done item out of the Done band', () => {
    const result = project([makeItem({ id: 'a', bucket: 'done' })], 'status', {}, ['a']);
    expect(result.pinned.map((i) => i.id)).toEqual(['a']);
    expect(result.groups).toEqual([]);
  });
});

describe('projectSidebar — repo view', () => {
  it('merges a teammate item into the same repo group as mine', () => {
    const result = project(
      [
        makeItem({ id: 'mine', repoId: 'r1', repoLabel: 'alpha', updatedAt: NOW }),
        makeItem({
          id: 'theirs',
          repoId: 'r1',
          repoLabel: 'alpha',
          ownership: 'team',
          owner: { name: 'Kai Ahn', avatarUrl: null },
          updatedAt: NOW - 5,
        }),
      ],
      'repo',
      { sortBy: 'recent' }
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe('r1');
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['mine', 'theirs']);
  });

  it('marks every group as a repo group and labels it with the repo', () => {
    const result = project([makeItem({ id: 'a', repoId: 'r1', repoLabel: 'alpha' })], 'repo');
    expect(result.groups[0].kind).toBe('repo');
    expect(result.groups[0].label).toBe('alpha');
  });

  it('leads with the repo holding the newest work', () => {
    const result = project(
      [
        makeItem({ id: 'old', repoId: 'repo-a', repoLabel: 'alpha', updatedAt: NOW - 5000 }),
        makeItem({ id: 'new', repoId: 'repo-b', repoLabel: 'beta', updatedAt: NOW - 10 }),
      ],
      'repo'
    );
    expect(result.groups.map((g) => g.key)).toEqual(['repo-b', 'repo-a']);
  });

  it('orders repo groups by name when asked', () => {
    const result = project(
      [
        makeItem({ id: 'x', repoId: 'repo-z', repoLabel: 'zeta', updatedAt: NOW }),
        makeItem({ id: 'y', repoId: 'repo-a', repoLabel: 'alpha', updatedAt: NOW - 5 }),
      ],
      'repo',
      { repoOrder: 'name' }
    );
    expect(result.groups.map((g) => g.label)).toEqual(['alpha', 'zeta']);
  });

  it('keeps a done item inside its repo group, always last', () => {
    const result = project(
      [
        makeItem({ id: 'finished', bucket: 'done', name: 'Aaa', updatedAt: NOW }),
        makeItem({ id: 'live', bucket: 'idle', name: 'Zzz', updatedAt: NOW - 500 }),
      ],
      'repo',
      { sortBy: 'name' }
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['live', 'finished']);
  });

  it('sorts by attention inside a repo group, breaking ties on recency', () => {
    const result = project(
      [
        makeItem({ id: 'idle-new', bucket: 'idle', updatedAt: NOW }),
        makeItem({ id: 'ready', bucket: 'ready_to_review', updatedAt: NOW - 9999 }),
        makeItem({ id: 'idle-old', bucket: 'idle', updatedAt: NOW - 500 }),
      ],
      'repo'
    );
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['ready', 'idle-new', 'idle-old']);
  });

  it('sorts by creation when asked, newest first', () => {
    const result = project(
      [
        makeItem({ id: 'old', createdAt: NOW - 90000 }),
        makeItem({ id: 'new', createdAt: NOW - 10 }),
      ],
      'repo',
      { sortBy: 'created' }
    );
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['new', 'old']);
  });
});

describe('projectSidebar — status view', () => {
  it('orders the bands needs_input, failed, ready_to_review, working, idle, done', () => {
    const result = project(
      [
        makeItem({ id: 'f', bucket: 'done' }),
        makeItem({ id: 'e', bucket: 'idle' }),
        makeItem({ id: 'd', bucket: 'working' }),
        makeItem({ id: 'c', bucket: 'ready_to_review' }),
        makeItem({ id: 'b', bucket: 'failed' }),
        makeItem({ id: 'a', bucket: 'needs_input' }),
      ],
      'status'
    );
    expect(result.groups.map((g) => g.key)).toEqual([
      'needs_input',
      'failed',
      'ready_to_review',
      'working',
      'idle',
      'done',
    ]);
    expect(result.groups.every((g) => g.kind === 'status')).toBe(true);
    expect(result.groups.map((g) => g.label)).toEqual([
      'Needs input',
      'Failed',
      'Ready to review',
      'Working',
      'Idle',
      'Done',
    ]);
  });

  it('omits a band with nothing in it', () => {
    const result = project(
      [makeItem({ id: 'a', bucket: 'idle' }), makeItem({ id: 'b', bucket: 'failed' })],
      'status'
    );
    expect(result.groups.map((g) => g.key)).toEqual(['failed', 'idle']);
  });

  it('lifts an item with a per-user reason into the needs_input band', () => {
    const result = project(
      [makeItem({ id: 'mentioned', bucket: 'idle', needsYou: [{ kind: 'mentioned', count: 2 }] })],
      'status'
    );
    expect(result.groups.map((g) => g.key)).toEqual(['needs_input']);
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['mentioned']);
  });

  it('leaves a failed or done item in its own band despite a per-user reason', () => {
    const result = project(
      [
        makeItem({ id: 'broken', bucket: 'failed', needsYou: [{ kind: 'mentioned', count: 1 }] }),
        makeItem({ id: 'merged', bucket: 'done', needsYou: [{ kind: 'mentioned', count: 1 }] }),
      ],
      'status'
    );
    expect(result.groups.map((g) => g.key)).toEqual(['failed', 'done']);
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['broken']);
    expect(result.groups[1].items.map((i) => i.id)).toEqual(['merged']);
  });

  it('merges mine and a teammate into the same band', () => {
    const result = project(
      [
        makeItem({ id: 'mine', bucket: 'working', updatedAt: NOW }),
        makeItem({
          id: 'theirs',
          bucket: 'working',
          ownership: 'team',
          owner: { name: 'Kai Ahn', avatarUrl: null },
          updatedAt: NOW - 5,
        }),
      ],
      'status',
      { sortBy: 'recent' }
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['mine', 'theirs']);
  });

  it('sorts a band by the chosen sort', () => {
    const result = project(
      [
        makeItem({ id: 'b', bucket: 'idle', name: 'Beta' }),
        makeItem({ id: 'a', bucket: 'idle', name: 'Alpha' }),
      ],
      'status',
      { sortBy: 'name' }
    );
    expect(result.groups[0].items.map((i) => i.name)).toEqual(['Alpha', 'Beta']);
  });

  it('always sorts the Done band most-recent-first, whatever the sort', () => {
    const result = project(
      [
        makeItem({ id: 'older', bucket: 'done', name: 'Aaa', updatedAt: NOW - 5000 }),
        makeItem({ id: 'newer', bucket: 'done', name: 'Zzz', updatedAt: NOW - 10 }),
      ],
      'status',
      { sortBy: 'name' }
    );
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['newer', 'older']);
  });
});

describe('projectSidebar — filters', () => {
  it('scopes to the chosen repos', () => {
    const result = project(
      [makeItem({ id: 'a', repoId: 'r1' }), makeItem({ id: 'b', repoId: 'r2' })],
      'repo',
      { visibleRepoIds: ['r2'] }
    );
    expect(renderedIds(result)).toEqual(['b']);
  });

  it('hides teammates on request, in both views', () => {
    const items = [makeItem({ id: 'mine' }), makeItem({ id: 'theirs', ownership: 'team' })];
    const filters = { ...DEFAULT_SIDEBAR_OPTIONS.filters, hideTeammates: true };
    expect(renderedIds(project(items, 'repo', { filters }))).toEqual(['mine']);
    expect(renderedIds(project(items, 'status', { filters }))).toEqual(['mine']);
  });

  it('hides done items on request, in both views', () => {
    const items = [makeItem({ id: 'live' }), makeItem({ id: 'finished', bucket: 'done' })];
    const filters = { ...DEFAULT_SIDEBAR_OPTIONS.filters, hideDone: true };
    expect(renderedIds(project(items, 'repo', { filters }))).toEqual(['live']);
    expect(project(items, 'status', { filters }).groups.map((g) => g.key)).toEqual(['idle']);
  });

  it('hides PR-less items on request', () => {
    const result = project([makeItem({ id: 'a' })], 'repo', {
      filters: { ...DEFAULT_SIDEBAR_OPTIONS.filters, hideWithoutPullRequest: true },
    });
    expect(result.groups).toEqual([]);
  });

  it('hides only items idle for more than seven days', () => {
    const items = [
      makeItem({ id: 'stale', bucket: 'idle', updatedAt: NOW - 8 * 24 * 3600 }),
      makeItem({ id: 'fresh', bucket: 'idle', updatedAt: NOW - 3600 }),
      makeItem({ id: 'stale-but-working', bucket: 'working', updatedAt: NOW - 8 * 24 * 3600 }),
    ];
    const result = project(items, 'repo', {
      filters: { ...DEFAULT_SIDEBAR_OPTIONS.filters, hideIdleOverSevenDays: true },
    });
    expect(renderedIds(result).sort()).toEqual(['fresh', 'stale-but-working']);
  });
});

describe('normalizeSidebarView', () => {
  it('keeps a stored view', () => {
    expect(normalizeSidebarView('status')).toBe('status');
    expect(normalizeSidebarView('repo')).toBe('repo');
  });

  it('falls back to repo for anything else', () => {
    expect(normalizeSidebarView(undefined)).toBe('repo');
    expect(normalizeSidebarView('flat')).toBe('repo');
    expect(normalizeSidebarView(7)).toBe('repo');
  });
});
