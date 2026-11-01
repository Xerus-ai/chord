import { describe, expect, it } from 'vitest';
import { artifactPathTab, filePathTab, type DocumentTab, type StripTab } from './center-tab';
import {
  closeTab,
  defaultActiveForSessions,
  EMPTY_CENTER_TABS,
  ensureSessionTabs,
  moveTab,
  normalizePathTabs,
  openTab,
  pruneTabs,
  reconcileSessions,
  type CenterTabsState,
} from './center-tabs-model';

const art = (id: string): DocumentTab => artifactPathTab(id, `${id}.md`);

const file = (filePath: string): DocumentTab => filePathTab(filePath);

const session = (id: string): StripTab => ({ kind: 'session', sessionId: id });

function withTabs(...tabs: DocumentTab[]): CenterTabsState {
  return tabs.reduce((state, tab) => openTab(state, tab, { preview: false }), EMPTY_CENTER_TABS);
}

describe('pruneTabs', () => {
  it('drops tabs that no longer exist and repairs focus', () => {
    const state = pruneTabs(
      withTabs(art('a'), file('gone.ts'), art('b')),
      (tab) => tab.kind === 'path' && tab.artifactId === undefined
    );
    expect(state.tabs.map((t) => t.kind === 'path' && t.artifactId)).toEqual(['a', 'b']);
    expect(state.active).toMatchObject({ artifactId: 'b' });
  });

  it('returns the same state when nothing is stale', () => {
    const state = withTabs(art('a'));
    expect(pruneTabs(state, () => false)).toBe(state);
  });

  it('never touches session tabs, even if the stale predicate would match their shape', () => {
    const state = openTab(withTabs(art('a')), session('s1'), { preview: false });
    const next = pruneTabs(state, () => true);
    expect(next.tabs.map((t) => t.kind)).toEqual(['session']);
  });
});

describe('reconcileSessions', () => {
  it('drops session tabs whose id is no longer live', () => {
    let state = openTab(EMPTY_CENTER_TABS, session('s1'), { preview: false });
    state = openTab(state, session('s2'), { preview: false });
    const next = reconcileSessions(state, new Set(['s2']));
    expect(next.tabs).toEqual([session('s2')]);
  });

  it('falls back active to the left neighbour when the active session is dropped', () => {
    const state = openTab(withTabs(art('a')), session('s1'), { preview: false });
    const next = reconcileSessions(state, new Set());
    expect(next.tabs).toEqual([{ ...art('a'), isPreview: false }]);
    expect(next.active).toMatchObject({ artifactId: 'a' });
  });

  it('leaves document tabs alone', () => {
    const state = withTabs(art('a'), art('b'));
    expect(reconcileSessions(state, new Set())).toBe(state);
  });
});

describe('defaultActiveForSessions', () => {
  it('opens and focuses the lone live chat session when the item is untouched', () => {
    const next = defaultActiveForSessions(EMPTY_CENTER_TABS, ['s1']);
    expect(next.tabs).toEqual([session('s1')]);
    expect(next.active).toEqual(session('s1'));
    expect(next.sessionDefaultApplied).toBe(true);
  });

  it('does nothing when there is more than one chat session', () => {
    expect(defaultActiveForSessions(EMPTY_CENTER_TABS, ['s1', 's2'])).toBe(EMPTY_CENTER_TABS);
  });

  it('does nothing when there are no chat sessions', () => {
    expect(defaultActiveForSessions(EMPTY_CENTER_TABS, [])).toBe(EMPTY_CENTER_TABS);
  });

  it('does not override a user who already navigated (stored tabs present)', () => {
    const state = withTabs(art('a'));
    expect(defaultActiveForSessions(state, ['s1'])).toBe(state);
  });

  it('does not re-open the session a user closed', () => {
    let state = openTab(EMPTY_CENTER_TABS, session('s1'), { preview: false });
    state = closeTab(state, session('s1'));
    const next = defaultActiveForSessions(state, ['s1']);
    expect(next).toBe(state);
    expect(next.active).toBeNull();
  });

  it('is idempotent: applying twice does not re-run or change anything', () => {
    const once = defaultActiveForSessions(EMPTY_CENTER_TABS, ['s1']);
    const twice = defaultActiveForSessions(once, ['s1']);
    expect(twice).toBe(once);
  });
});

describe('moveTab', () => {
  it('reorders a tab to a new index', () => {
    const state = withTabs(art('a'), art('b'), art('c'));
    const next = moveTab(state, 'artifact:a', 2);
    expect(next.tabs.map((t) => t.kind === 'path' && t.artifactId)).toEqual(['b', 'c', 'a']);
  });

  it('returns the same state for an unknown key', () => {
    const state = withTabs(art('a'));
    expect(moveTab(state, 'artifact:zzz', 0)).toBe(state);
  });

  it('returns the same state when the index does not change', () => {
    const state = withTabs(art('a'), art('b'));
    expect(moveTab(state, 'artifact:a', 0)).toBe(state);
  });

  it('clamps out-of-range indexes to the list bounds', () => {
    const state = withTabs(art('a'), art('b'));
    const next = moveTab(state, 'artifact:a', 99);
    expect(next.tabs.map((t) => t.kind === 'path' && t.artifactId)).toEqual(['b', 'a']);
  });
});

describe('ensureSessionTabs', () => {
  it('appends tabs for live sessions without a tab and keeps focus', () => {
    const state = openTab(withTabs(art('a')), session('s1'), { preview: false });
    const next = ensureSessionTabs(state, ['s1', 's2']);
    expect(next.tabs).toEqual([...state.tabs, session('s2')]);
    expect(next.active).toEqual(state.active);
  });

  it('returns the same state when every live session already has a tab', () => {
    const state = openTab(EMPTY_CENTER_TABS, session('s1'), { preview: false });
    expect(ensureSessionTabs(state, ['s1'])).toBe(state);
  });
});

/**
 * A tab opened by id (ARTIFACTS, a chat chip) and one opened by path (Files,
 * Changes) are the same tab once the artifact list says which file the
 * artifact is. Normalizing fills in what each side lacks and merges tabs that
 * turn out to be one.
 */
describe('normalizePathTabs', () => {
  const artifacts = [
    { id: 'a1', name: 'Spec', repoRelativePath: 'docs/spec.md' },
    { id: 'plan', name: 'Add notes.txt', repoRelativePath: null },
  ];

  it('gives an artifact tab its repo path', () => {
    const state = normalizePathTabs(withTabs(artifactPathTab('a1', 'Spec')), artifacts);
    expect(state.tabs).toEqual([
      { kind: 'path', artifactId: 'a1', title: 'Spec', filePath: 'docs/spec.md', isPreview: false },
    ]);
    expect(state.active).toEqual(state.tabs[0]);
  });

  it('marks a primary-worktree file tab as the artifact it is, titled by the artifact', () => {
    const state = normalizePathTabs(withTabs(filePathTab('docs/spec.md')), artifacts);
    expect(state.tabs[0]).toMatchObject({
      artifactId: 'a1',
      title: 'Spec',
      filePath: 'docs/spec.md',
    });
  });

  it("leaves another worktree's copy of the path a plain file", () => {
    const tab = filePathTab('docs/spec.md', { worktreeId: 'w2' });
    const state = normalizePathTabs(withTabs(tab), artifacts);
    expect(state.tabs[0]).not.toHaveProperty('artifactId');
  });

  it('merges the two entry points into one tab, keeping the first and its mode', () => {
    const state = normalizePathTabs(
      withTabs(
        filePathTab('docs/spec.md', { mode: 'diff' }),
        art('x'),
        artifactPathTab('a1', 'Spec')
      ),
      artifacts
    );
    expect(state.tabs.map((t) => (t.kind === 'path' ? t.artifactId : null))).toEqual(['a1', 'x']);
    expect(state.tabs[0]).toMatchObject({ mode: 'diff' });
    // The merged-away tab was active; its survivor is now.
    expect(state.active).toEqual(state.tabs[0]);
  });

  it('keeps an artifact with no repo file keyed by id', () => {
    const state = normalizePathTabs(withTabs(artifactPathTab('plan', 'Add notes.txt')), artifacts);
    expect(state.tabs[0]).not.toHaveProperty('filePath');
  });

  it('turns a file tab whose artifact was deleted back into a plain file', () => {
    const state = normalizePathTabs(
      withTabs(artifactPathTab('gone', 'Old', { filePath: 'old.md' })),
      artifacts
    );
    expect(state.tabs[0]).toEqual({
      kind: 'path',
      filePath: 'old.md',
      title: 'old.md',
      isPreview: false,
    });
  });

  it('treats the primary worktree named by id as the primary worktree (Files passes its id)', () => {
    const state = normalizePathTabs(
      withTabs(
        artifactPathTab('a1', 'Spec'),
        filePathTab('docs/spec.md', { worktreeId: 'wt-primary' }),
        filePathTab('other.ts', { worktreeId: 'wt-feature' })
      ),
      artifacts,
      'wt-primary'
    );
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0]).toMatchObject({ artifactId: 'a1', filePath: 'docs/spec.md' });
    expect(state.tabs[0]).not.toHaveProperty('worktreeId');
    expect(state.tabs[1]).toMatchObject({ filePath: 'other.ts', worktreeId: 'wt-feature' });
  });

  it('returns the same state when nothing changes', () => {
    const state = normalizePathTabs(
      withTabs(artifactPathTab('a1', 'Spec', { filePath: 'docs/spec.md' })),
      artifacts
    );
    expect(normalizePathTabs(state, artifacts)).toBe(state);
  });
});
