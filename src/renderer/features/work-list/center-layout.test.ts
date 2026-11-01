import { describe, expect, it } from 'vitest';
import {
  activateTabInLayout,
  closeTabInLayout,
  createCenterLayout,
  EMPTY_CENTER_LAYOUT,
  findPane,
  getFocusedPane,
  listPanes,
  openTabInLayout,
  resizeSplit,
  syncSessionTabsInLayout,
  updateFocusedPane,
  type CenterLayoutState,
} from './center-layout';
import { moveTabInLayout, openToSide, splitPane, type MoveTabRequest } from './center-layout-split';
import { filePathTab, type CenterTab, type DocumentTab, type StripTab } from './center-tab';
import { closeAllTabs } from './center-tabs-model';

const file = (filePath: string): DocumentTab => ({ ...filePathTab(filePath), isPreview: false });
const session = (id: string): StripTab => ({ kind: 'session', sessionId: id });

function open(layout: CenterLayoutState, ...tabs: CenterTab[]): CenterLayoutState {
  return tabs.reduce((l, tab) => openTabInLayout(l, tab, { preview: false }), layout);
}

/** Room + a.ts in pane-0, b.ts and session s1 in pane-1 to its right. */
function twoPanes(): CenterLayoutState {
  const left = open(EMPTY_CENTER_LAYOUT, file('a.ts'));
  return open(splitPane(left, 'pane-0', 'horizontal'), file('b.ts'), session('s1'));
}

describe('splitPane', () => {
  it('adds an empty focused pane beside the original with deterministic ids', () => {
    const layout = splitPane(EMPTY_CENTER_LAYOUT, 'pane-0', 'horizontal');
    expect(layout.root).toMatchObject({
      kind: 'split',
      id: 'split-2',
      direction: 'horizontal',
      sizes: [50, 50],
    });
    expect(listPanes(layout.root).map((p) => p.id)).toEqual(['pane-0', 'pane-1']);
    expect(layout.focusedPaneId).toBe('pane-1');
    expect(layout.nextId).toBe(3);
  });

  it('puts the new pane first on a before split, keeping ids, focus and the Room', () => {
    const layout = splitPane(
      open(EMPTY_CENTER_LAYOUT, file('a.ts')),
      'pane-0',
      'vertical',
      file('b.ts'),
      'before'
    );
    expect(layout.root).toMatchObject({ kind: 'split', id: 'split-2', direction: 'vertical' });
    expect(listPanes(layout.root).map((p) => [p.id, p.tabs])).toEqual([
      ['pane-1', [file('b.ts')]],
      ['pane-0', [file('a.ts')]],
    ]);
    expect(layout.focusedPaneId).toBe('pane-1');
  });

  it('caps nesting at two splits', () => {
    const once = splitPane(EMPTY_CENTER_LAYOUT, 'pane-0', 'horizontal');
    const twice = splitPane(once, 'pane-1', 'vertical');
    expect(listPanes(twice.root)).toHaveLength(3);
    expect(splitPane(twice, twice.focusedPaneId, 'horizontal')).toBe(twice);
    expect(splitPane(twice, 'pane-0', 'vertical')).not.toBe(twice);
  });

  it('moves a session tab out of its old pane', () => {
    const layout = splitPane(open(twoPanes(), file('c.ts')), 'pane-0', 'vertical', session('s1'));
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts'), file('c.ts')]);
    expect(getFocusedPane(layout)).toMatchObject({ tabs: [session('s1')], active: session('s1') });
  });
});

describe('openTabInLayout', () => {
  it('opens a document in the focused pane', () => {
    const layout = twoPanes();
    expect(getFocusedPane(layout).tabs).toEqual([file('b.ts'), session('s1')]);
    const opened = openTabInLayout(layout, file('c.ts'), { preview: false });
    expect(getFocusedPane(opened).active).toEqual(file('c.ts'));
    expect(findPane(opened, 'pane-0')?.tabs).toEqual([file('a.ts')]);
  });

  it('focuses the pane already showing a session instead of duplicating it', () => {
    const layout = open(focusLeft(twoPanes()), session('s1'));
    expect(layout.focusedPaneId).toBe('pane-1');
    expect(findPane(layout, 'pane-0')?.tabs).toEqual([file('a.ts')]);
  });

  it('lets a document be open in two panes', () => {
    const layout = open(twoPanes(), file('a.ts'));
    expect(findPane(layout, 'pane-0')?.tabs).toEqual([file('a.ts')]);
    expect(findPane(layout, 'pane-1')?.tabs).toContainEqual(file('a.ts'));
  });
});

describe('activateTabInLayout', () => {
  it('focuses the pane holding the tab', () => {
    const layout = activateTabInLayout(twoPanes(), file('a.ts'));
    expect(layout.focusedPaneId).toBe('pane-0');
    expect(getFocusedPane(layout).active).toEqual(file('a.ts'));
  });

  it('ignores a tab no pane holds', () => {
    const layout = twoPanes();
    expect(activateTabInLayout(layout, file('zzz.ts'))).toBe(layout);
  });
});

describe('closeTabInLayout', () => {
  it('collapses a non-room pane that loses its last tab and refocuses the sibling', () => {
    const layout = closeTabInLayout(
      closeTabInLayout(twoPanes(), file('b.ts'), 'pane-1'),
      session('s1'),
      'pane-1'
    );
    expect(layout.root).toMatchObject({ kind: 'pane', id: 'pane-0' });
    expect(layout.focusedPaneId).toBe('pane-0');
  });

  it('moves focus to the new first tab when the active first tab closes', () => {
    const layout = closeTabInLayout(activateTabInLayout(twoPanes(), file('b.ts')), file('b.ts'));
    expect(getFocusedPane(layout).active).toEqual(session('s1'));
  });

  // Without the Room there is no pane that outlives its tabs: an emptied pane
  // hands its space back to its sibling.
  it('collapses a pane into its sibling when it empties', () => {
    const layout = closeTabInLayout(twoPanes(), file('a.ts'), 'pane-0');
    expect(listPanes(layout.root)).toHaveLength(1);
    expect(findPane(layout, 'pane-0')).toBeUndefined();
  });

  // ...except the last one, which has no sibling to collapse into and shows
  // its empty state instead.
  it('keeps the only pane when it empties, with nothing active', () => {
    const layout = closeTabInLayout(open(EMPTY_CENTER_LAYOUT, file('a.ts')), file('a.ts'));
    expect(listPanes(layout.root)).toHaveLength(1);
    expect(findPane(layout, 'pane-0')).toMatchObject({ tabs: [], active: null });
  });

  it('collapses through bulk transitions on the focused pane', () => {
    const layout = updateFocusedPane(closeTabInLayout(twoPanes(), session('s1')), closeAllTabs);
    expect(layout.root.kind).toBe('pane');
  });
});

describe('openToSide', () => {
  it('splits a lone pane', () => {
    const layout = openToSide(open(EMPTY_CENTER_LAYOUT, file('a.ts')), file('b.ts'), {
      preview: false,
    });
    expect(listPanes(layout.root)).toHaveLength(2);
    expect(getFocusedPane(layout).tabs).toEqual([file('b.ts')]);
  });

  it('opens in the next pane when one exists', () => {
    const layout = openToSide(focusLeft(twoPanes()), file('c.ts'), { preview: false });
    expect(layout.focusedPaneId).toBe('pane-1');
    expect(getFocusedPane(layout).tabs).toContainEqual(file('c.ts'));
  });
});

describe('moveTabInLayout', () => {
  it('reorders within a pane', () => {
    const layout = moveTabInLayout(twoPanes(), {
      key: 'session:s1',
      fromPaneId: 'pane-1',
      toPaneId: 'pane-1',
      toIndex: 0,
    });
    expect(getFocusedPane(layout).tabs).toEqual([session('s1'), file('b.ts')]);
  });

  it('moves across panes at an index and focuses the target', () => {
    const layout = moveTabInLayout(twoPanes(), {
      key: 'session:s1',
      fromPaneId: 'pane-1',
      toPaneId: 'pane-0',
      toIndex: 0,
    });
    expect(findPane(layout, 'pane-0')).toMatchObject({
      tabs: [session('s1'), file('a.ts')],
      active: session('s1'),
    });
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts')]);
    expect(layout.focusedPaneId).toBe('pane-0');
  });

  it('drops onto an edge to split, collapsing an emptied source', () => {
    const start = closeTabInLayout(twoPanes(), file('b.ts'));
    const layout = moveTabInLayout(start, {
      key: 'session:s1',
      fromPaneId: 'pane-1',
      toPaneId: 'pane-0',
      split: 'vertical',
    });
    expect(layout.root).toMatchObject({ kind: 'split', direction: 'vertical' });
    expect(listPanes(layout.root).map((p) => p.tabs)).toEqual([[file('a.ts')], [session('s1')]]);
    expect(getFocusedPane(layout).active).toEqual(session('s1'));
  });

  it('drops onto a left edge to split before the target', () => {
    const layout = moveTabInLayout(twoPanes(), {
      key: 'session:s1',
      fromPaneId: 'pane-1',
      toPaneId: 'pane-0',
      split: 'horizontal',
      side: 'before',
    });
    expect(listPanes(layout.root).map((p) => p.tabs)).toEqual([
      [session('s1')],
      [file('a.ts')],
      [file('b.ts')],
    ]);
    expect(getFocusedPane(layout).active).toEqual(session('s1'));
  });

  it('ignores splitting a pane with its own only tab', () => {
    const layout = closeTabInLayout(twoPanes(), file('b.ts'));
    const move: MoveTabRequest = {
      key: 'session:s1',
      fromPaneId: 'pane-1',
      toPaneId: 'pane-1',
      split: 'vertical',
    };
    expect(moveTabInLayout(layout, move)).toBe(layout);
  });
});

describe('resizeSplit', () => {
  it('normalizes sizes to percentages', () => {
    const layout = resizeSplit(twoPanes(), 'split-2', [1, 3]);
    expect(layout.root).toMatchObject({ sizes: [25, 75] });
  });

  it('ignores non-positive sizes and unknown splits', () => {
    const layout = twoPanes();
    expect(resizeSplit(layout, 'split-2', [0, 100])).toBe(layout);
    expect(resizeSplit(layout, 'split-9', [40, 60])).toBe(layout);
  });
});

describe('syncSessionTabsInLayout', () => {
  // Step 5, decision 5: the owner's rule is the teammate's. A done chat keeps
  // a tab it already has (an ended chat reopened from `+`, or revealed by a
  // notification); only a session that no longer exists loses its tab.
  it('keeps a done session’s tab and adds missing active ones to the focused pane only', () => {
    const layout = syncSessionTabsInLayout(focusLeft(twoPanes()), [
      { id: 's1', kind: 'chat', status: 'done' },
      { id: 's2', kind: 'terminal', status: 'active' },
    ]);
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts'), session('s1')]);
    expect(findPane(layout, 'pane-0')?.tabs).toEqual([file('a.ts'), session('s2')]);
  });

  it('drops the tab of a session that no longer exists', () => {
    const layout = syncSessionTabsInLayout(focusLeft(twoPanes()), []);
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts')]);
  });

  it('never opens a done session on its own', () => {
    const layout = syncSessionTabsInLayout(createCenterLayout(), [
      { id: 's1', kind: 'chat', status: 'done' },
    ]);
    expect(getFocusedPane(layout).tabs).toEqual([]);
  });

  it('does not add a session another pane already shows', () => {
    const layout = focusLeft(twoPanes());
    expect(syncSessionTabsInLayout(layout, [{ id: 's1', kind: 'chat', status: 'active' }])).toBe(
      layout
    );
  });

  it('applies the single-session default on a fresh one-pane layout', () => {
    const layout = syncSessionTabsInLayout(createCenterLayout(), [
      { id: 's1', kind: 'chat', status: 'suspended' },
    ]);
    expect(getFocusedPane(layout)).toMatchObject({ tabs: [session('s1')], active: session('s1') });
  });
});

function focusLeft(layout: CenterLayoutState): CenterLayoutState {
  return { ...layout, focusedPaneId: 'pane-0' };
}
