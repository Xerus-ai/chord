import { describe, expect, it } from 'vitest';
import { EMPTY_CENTER_LAYOUT, openTabInLayout } from './center-layout';
import { moveTabInLayout, splitPane } from './center-layout-split';
import { centerTabKey, filePathTab, ITEM_CHAT_TAB, type StripTab } from './center-tab';
import { listRetainedBodies } from './retained-bodies';

const session = (id: string): StripTab => ({ kind: 'session', sessionId: id });
const rows = new Map([
  ['s1', { id: 's1' }],
  ['s2', { id: 's2' }],
]);

describe('listRetainedBodies', () => {
  it('lists known sessions with their pane, visibility and focus', () => {
    const layout = openTabInLayout(
      openTabInLayout(EMPTY_CENTER_LAYOUT, session('s1'), { preview: false }),
      session('ghost'),
      { preview: false }
    );
    expect(listRetainedBodies(layout, rows)).toEqual([
      {
        key: 'session:s1',
        paneId: 'pane-0',
        session: rows.get('s1'),
        active: false,
        focused: true,
      },
    ]);
  });

  it('keeps keys stable while a split and a cross-pane move reshape the tree', () => {
    const start = openTabInLayout(EMPTY_CENTER_LAYOUT, session('s1'), { preview: false });
    const split = splitPane(start, 'pane-0', 'horizontal', session('s2'), 'before');
    const moved = moveTabInLayout(split, {
      key: 'session:s1',
      fromPaneId: 'pane-0',
      toPaneId: 'pane-1',
    });
    const keyed = (l: typeof moved) =>
      Object.fromEntries(listRetainedBodies(l, rows).map((b) => [b.key, [b.paneId, b.active]]));

    expect(keyed(split)).toEqual({
      'session:s1': ['pane-0', true],
      'session:s2': ['pane-1', true],
    });
    expect(keyed(moved)).toEqual({
      'session:s1': ['pane-1', true],
      'session:s2': ['pane-1', false],
    });
  });
});

/**
 * A teammate's item with no chats yet: its whole chat is the Work item chat
 * tab (step 4, decision 5), and the body goes wherever that tab is.
 */
describe('listRetainedBodies, the work-item chat', () => {
  const chatOf = (layout: typeof EMPTY_CENTER_LAYOUT) =>
    listRetainedBodies(layout, new Map(), { workItemChat: true }).find(
      (body) => body.key === 'work-item-chat'
    );
  const withItemChat = openTabInLayout(EMPTY_CENTER_LAYOUT, ITEM_CHAT_TAB, { preview: false });

  it('is shown in the pane that holds the Work item chat tab, while that tab is active', () => {
    expect(chatOf(withItemChat)).toEqual({
      key: 'work-item-chat',
      paneId: 'pane-0',
      session: null,
      active: true,
      focused: true,
    });
  });

  it('hides behind another tab active in that pane', () => {
    const layout = openTabInLayout(withItemChat, filePathTab('a.ts'), { preview: false });
    expect(chatOf(layout)?.active).toBe(false);
  });

  it('moves with its tab to another pane', () => {
    const split = splitPane(withItemChat, 'pane-0', 'horizontal');
    const moved = moveTabInLayout(split, {
      key: centerTabKey(ITEM_CHAT_TAB),
      fromPaneId: 'pane-0',
      toPaneId: 'pane-1',
    });
    expect(chatOf(moved)).toMatchObject({ paneId: 'pane-1', active: true });
  });

  it('is not listed without its tab', () => {
    expect(chatOf(EMPTY_CENTER_LAYOUT)).toBeUndefined();
  });

  it('is not listed for a view that has sessions instead', () => {
    expect(listRetainedBodies(EMPTY_CENTER_LAYOUT, rows).map((b) => b.key)).toEqual([]);
  });
});
