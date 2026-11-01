import { describe, expect, it } from 'vitest';
import { createCenterLayout, openTabInLayout } from './center-layout';
import { splitPane } from './center-layout-split';
import { filePathTab } from './center-tab';
import { migrateCenterTabs, selectOpenCenterTabs } from './center-tabs-store';

describe('migrateCenterTabs', () => {
  it('turns a v2 flat strip into a one-pane tree', () => {
    const tabs = [{ kind: 'session', sessionId: 's1' }];
    const migrated = migrateCenterTabs(
      { byWorkItem: { w1: { tabs, active: tabs[0], sessionDefaultApplied: true } } },
      2
    );
    expect(migrated.layouts.w1).toEqual({
      root: { kind: 'pane', id: 'pane-0', tabs, active: tabs[0] },
      focusedPaneId: 'pane-0',
      nextId: 1,
      sessionDefaultApplied: true,
      seenSessionIds: [],
    });
  });

  it('fills v1 gaps with nothing active and an unapplied session default', () => {
    const migrated = migrateCenterTabs({ byWorkItem: { w1: {} } }, 1);
    expect(migrated.layouts.w1).toMatchObject({
      root: { kind: 'pane', tabs: [], active: null },
      sessionDefaultApplied: false,
    });
  });

  it('turns v3 file, diff and artifact tabs into path tabs in every pane', () => {
    const left = {
      kind: 'pane',
      id: 'pane-0',
      tabs: [
        { kind: 'file', filePath: 'src/a.ts', line: 4, isPreview: true },
        { kind: 'diff', filePath: 'src/b.ts', worktreeId: 'w2' },
      ],
      active: { kind: 'diff', filePath: 'src/b.ts', worktreeId: 'w2' },
    };
    const right = {
      kind: 'pane',
      id: 'pane-1',
      tabs: [
        { kind: 'artifact', artifactId: 'a1', title: 'Spec' },
        { kind: 'session', sessionId: 's1' },
      ],
      active: null,
    };
    const v3 = {
      layouts: {
        w1: {
          root: {
            kind: 'split',
            id: 'split-0',
            direction: 'horizontal',
            sizes: [50, 50],
            children: [left, right],
          },
          focusedPaneId: 'pane-0',
          nextId: 2,
          sessionDefaultApplied: true,
        },
      },
    };
    const migrated = migrateCenterTabs(v3, 3) as unknown as typeof v3;
    const [l, r] = migrated.layouts.w1.root.children;
    expect(l.tabs).toEqual([
      { kind: 'path', filePath: 'src/a.ts', title: 'a.ts', line: 4, isPreview: true },
      { kind: 'path', filePath: 'src/b.ts', title: 'b.ts', worktreeId: 'w2', mode: 'diff' },
    ]);
    expect(l.active).toEqual(l.tabs[1]);
    expect(r.tabs).toEqual([
      { kind: 'path', artifactId: 'a1', title: 'Spec' },
      { kind: 'session', sessionId: 's1' },
    ]);
    expect(r.active).toBeNull();
  });

  it('carries a v2 flat strip all the way to path tabs', () => {
    const migrated = migrateCenterTabs(
      { byWorkItem: { w1: { tabs: [{ kind: 'file', filePath: 'a.ts' }] } } },
      2
    );
    expect(migrated.layouts.w1.root).toMatchObject({
      tabs: [{ kind: 'path', filePath: 'a.ts', title: 'a.ts' }],
    });
  });

  it('gives every v4 layout an empty seen list, so a teammate view opens one unseen chat', () => {
    const layout = {
      root: { kind: 'pane', id: 'pane-0', tabs: [], active: null },
      focusedPaneId: 'pane-0',
      nextId: 1,
      sessionDefaultApplied: true,
    };
    const migrated = migrateCenterTabs({ layouts: { w1: layout } }, 4);
    expect(migrated.layouts.w1).toEqual({ ...layout, seenSessionIds: [] });
  });

  it('leaves a v5 state as is', () => {
    const state = { layouts: {} };
    expect(migrateCenterTabs(state, 5)).toBe(state);
  });
});

describe('selectOpenCenterTabs', () => {
  const file = (filePath: string) => filePathTab(filePath);

  it('returns the same array for an unchanged multi-pane layout', () => {
    const split = splitPane(
      openTabInLayout(createCenterLayout(), file('a.ts'), { preview: false }),
      'pane-0',
      'horizontal'
    );
    const layout = openTabInLayout(split, file('b.ts'), { preview: false });
    const store = { layouts: { w1: layout } };
    const first = selectOpenCenterTabs(store, 'w1');
    expect(first?.map((t) => t.kind === 'path' && t.filePath)).toEqual(['a.ts', 'b.ts']);
    expect(selectOpenCenterTabs({ layouts: { w1: layout } }, 'w1')).toBe(first);
  });

  it("returns the lone pane's own array and undefined for an unknown item", () => {
    const layout = openTabInLayout(createCenterLayout(), file('a.ts'), { preview: false });
    const store = { layouts: { w1: layout } };
    expect(selectOpenCenterTabs(store, 'w1')).toBe(layout.root.kind === 'pane' && layout.root.tabs);
    expect(selectOpenCenterTabs(store, 'w2')).toBeUndefined();
    expect(selectOpenCenterTabs(store, undefined)).toBeUndefined();
  });
});
