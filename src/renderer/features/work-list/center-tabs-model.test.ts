import { describe, expect, it } from 'vitest';
import { artifactPathTab, filePathTab, type DocumentTab, type StripTab } from './center-tab';
import {
  activateTab,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToLeft,
  closeTabsToRight,
  EMPTY_CENTER_TABS,
  openTab,
  promoteTab,
  type CenterTabsState,
} from './center-tabs-model';

const art = (id: string): DocumentTab => artifactPathTab(id, `${id}.md`);

const session = (id: string): StripTab => ({ kind: 'session', sessionId: id });

function withTabs(...tabs: DocumentTab[]): CenterTabsState {
  return tabs.reduce((state, tab) => openTab(state, tab, { preview: false }), EMPTY_CENTER_TABS);
}

describe('openTab', () => {
  it('appends a permanent tab and activates it', () => {
    const state = openTab(EMPTY_CENTER_TABS, art('a'), { preview: false });
    expect(state.tabs).toEqual([{ ...art('a'), isPreview: false }]);
    expect(state.active).toEqual({ ...art('a'), isPreview: false });
  });

  it('focuses an already-open tab instead of duplicating it', () => {
    const state = openTab(withTabs(art('a'), art('b')), art('a'), { preview: false });
    expect(state.tabs.map((t) => t.kind === 'path' && t.artifactId)).toEqual(['a', 'b']);
    expect(state.active).toMatchObject({ kind: 'path', artifactId: 'a' });
  });

  it('replaces the existing preview tab in place', () => {
    let state = withTabs(art('pinned'));
    state = openTab(state, art('a'), { preview: true });
    state = openTab(state, art('b'), { preview: true });
    expect(state.tabs).toEqual([
      { ...art('pinned'), isPreview: false },
      { ...art('b'), isPreview: true },
    ]);
    expect(state.active).toMatchObject({ artifactId: 'b', isPreview: true });
  });

  it('never demotes a permanent tab when it is re-opened as a preview', () => {
    const state = openTab(withTabs(art('a')), art('a'), { preview: true });
    expect(state.tabs).toEqual([{ ...art('a'), isPreview: false }]);
  });

  it('promotes a preview tab when it is opened permanently', () => {
    const state = openTab(openTab(EMPTY_CENTER_TABS, art('a'), { preview: true }), art('a'), {
      preview: false,
    });
    expect(state.tabs).toEqual([{ ...art('a'), isPreview: false }]);
  });

  it('re-opening a path updates the tab in place (a new line hint, the mode kept)', () => {
    let state = withTabs(filePathTab('src/a.ts', { mode: 'diff' }), art('x'));
    state = openTab(state, filePathTab('src/a.ts', { line: 42 }), { preview: false });
    expect(state.tabs[0]).toEqual({
      kind: 'path',
      filePath: 'src/a.ts',
      title: 'a.ts',
      mode: 'diff',
      line: 42,
      isPreview: false,
    });
    expect(state.tabs).toHaveLength(2);
  });

  it('re-opening with a mode switches the tab to it (Changes opens Diff)', () => {
    let state = withTabs(filePathTab('src/a.ts'));
    state = openTab(state, filePathTab('src/a.ts', { mode: 'diff' }), { preview: false });
    expect(state.tabs).toHaveLength(1);
    expect(state.active).toMatchObject({ filePath: 'src/a.ts', mode: 'diff' });
  });

  it('re-opening an artifact by id keeps the path the tab already has', () => {
    let state = withTabs(artifactPathTab('a1', 'Spec', { filePath: 'docs/spec.md' }));
    state = openTab(state, artifactPathTab('a1', 'Spec'), { preview: false });
    expect(state.tabs).toEqual([
      { kind: 'path', artifactId: 'a1', title: 'Spec', filePath: 'docs/spec.md', isPreview: false },
    ]);
  });

  // Closing the last tab leaves the pane with nothing active — the state the
  // pinned Room tab used to occupy.
  it('leaves nothing active when the last tab closes', () => {
    const state = closeTab(withTabs(art('a')), art('a'));
    expect(state.tabs).toHaveLength(0);
    expect(state.active).toBeNull();
  });

  it('stores a session tab in the strip, not just as active', () => {
    const state = openTab(withTabs(art('a')), session('s1'), { preview: false });
    expect(state.tabs).toEqual([{ ...art('a'), isPreview: false }, session('s1')]);
    expect(state.active).toEqual(session('s1'));
  });

  it('re-opening an already-open session focuses it instead of duplicating it', () => {
    let state = openTab(EMPTY_CENTER_TABS, session('s1'), { preview: false });
    state = openTab(state, art('a'), { preview: false });
    state = openTab(state, session('s1'), { preview: false });
    expect(state.tabs.map((t) => t.kind)).toEqual(['session', 'path']);
    expect(state.active).toEqual(session('s1'));
  });

  it('marks the state touched so the single-session default never fires afterwards', () => {
    const state = openTab(EMPTY_CENTER_TABS, art('a'), { preview: false });
    expect(state.sessionDefaultApplied).toBe(true);
  });
});

describe('promoteTab', () => {
  it('makes a preview tab permanent without changing focus', () => {
    let state = openTab(withTabs(art('a')), art('b'), { preview: true });
    state = activateTab(state, art('a'));
    state = promoteTab(state, art('b'));
    expect(state.tabs[1]).toEqual({ ...art('b'), isPreview: false });
    expect(state.active).toMatchObject({ artifactId: 'a' });
  });

  it('returns the same state when the tab is not open', () => {
    const state = withTabs(art('a'));
    expect(promoteTab(state, art('zzz'))).toBe(state);
  });
});

describe('closeTab', () => {
  it('focuses the left neighbour when the active tab closes', () => {
    const state = closeTab(withTabs(art('a'), art('b'), art('c')), art('c'));
    expect(state.tabs).toHaveLength(2);
    expect(state.active).toMatchObject({ artifactId: 'b' });
  });

  it('falls back to the new first tab when the active first tab closes', () => {
    let state = activateTab(withTabs(art('a'), art('b')), art('a'));
    state = closeTab(state, art('a'));
    expect(state.active).toEqual(state.tabs[0]);
  });

  it('keeps focus when an inactive tab closes', () => {
    const state = closeTab(withTabs(art('a'), art('b'), art('c')), art('a'));
    expect(state.active).toMatchObject({ artifactId: 'c' });
  });

  it('closing a session tab just drops it from state (caller ends the session itself)', () => {
    const state = openTab(withTabs(art('a')), session('s1'), { preview: false });
    const next = closeTab(state, session('s1'));
    expect(next.tabs).toEqual([{ ...art('a'), isPreview: false }]);
    expect(next.active).toMatchObject({ artifactId: 'a' });
  });
});

describe('bulk close', () => {
  // A session tab sits in the strip alongside the document tabs, but focus is
  // still on a document tab — the common case while working in a diff with a
  // background terminal open.
  const base = activateTab(withTabs(art('a'), art('b'), art('c'), art('d')), art('d'));
  const state: CenterTabsState = { ...base, tabs: [...base.tabs, session('sX')] };
  const ids = (s: CenterTabsState) =>
    s.tabs.map((t) => (t.kind === 'path' ? t.artifactId : t.kind));

  it('Close Others keeps only the target and any session tabs, and focuses the target', () => {
    const next = closeOtherTabs(state, art('b'));
    expect(ids(next)).toEqual(['b', 'session']);
    expect(next.active).toMatchObject({ artifactId: 'b' });
  });

  it('Close to the Right removes document tabs after the target but leaves sessions', () => {
    const next = closeTabsToRight(state, art('b'));
    expect(ids(next)).toEqual(['a', 'b', 'session']);
    expect(next.active).toMatchObject({ artifactId: 'b' });
  });

  it('Close to the Left removes document tabs before the target but leaves sessions', () => {
    const next = closeTabsToLeft(state, art('c'));
    expect(ids(next)).toEqual(['c', 'd', 'session']);
    expect(next.active).toMatchObject({ artifactId: 'd' });
  });

  it('Close All drops document tabs but leaves session tabs, focusing the first survivor', () => {
    const next = closeAllTabs(state);
    expect(ids(next)).toEqual(['session']);
    expect(next.active).toEqual(next.tabs[0]);
  });

  it('Close All leaves nothing active when no tab survives', () => {
    const next = closeAllTabs(activateTab(withTabs(art('a'), art('b')), art('a')));
    expect(next).toEqual({ tabs: [], active: null, sessionDefaultApplied: true });
  });
});
