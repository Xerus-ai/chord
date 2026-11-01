import { describe, expect, it } from 'vitest';
import {
  closeTabInLayout,
  EMPTY_CENTER_LAYOUT,
  findPane,
  getFocusedPane,
  openTabInLayout,
  syncCloudSessionTabsInLayout,
  type CenterLayoutState,
} from './center-layout';
import { splitPane } from './center-layout-split';
import {
  filePathTab,
  ITEM_CHAT_TAB,
  type CenterTab,
  type DocumentTab,
  type StripTab,
} from './center-tab';

const file = (filePath: string): DocumentTab => ({ ...filePathTab(filePath), isPreview: false });
const session = (id: string): StripTab => ({ kind: 'session', sessionId: id });

function open(layout: CenterLayoutState, ...tabs: CenterTab[]): CenterLayoutState {
  return tabs.reduce((l, tab) => openTabInLayout(l, tab, { preview: false }), layout);
}

/** a.ts in pane-0, b.ts and session s1 in pane-1 to its right; pane-0 focused. */
function focusLeft(layout: CenterLayoutState): CenterLayoutState {
  return { ...layout, focusedPaneId: 'pane-0' };
}

function twoPanes(): CenterLayoutState {
  const left = open(EMPTY_CENTER_LAYOUT, file('a.ts'));
  return open(splitPane(left, 'pane-0', 'horizontal'), file('b.ts'), session('s1'));
}

/**
 * A teammate's session tabs (shared-items step 4, decision 5; 8e decided
 * 2026-10-01). Unlike the owner's, a done session keeps its tab, and closing a
 * tab never ends the owner's session. A session the owner stopped publishing
 * loses its tab. Of the chats the view has not seen, the most recently active
 * one that is not done gains a tab, idle or not; the rest wait for the `+`.
 * The seen ids live in the layout, so a closed tab stays closed on every visit.
 */
describe('syncCloudSessionTabsInLayout', () => {
  const at = (hour: number) => `2026-10-01T${String(hour).padStart(2, '0')}:00:00Z`;
  const chat = (id: string, status: string, lastActiveAt = at(8)) => ({
    id,
    kind: 'chat',
    status,
    lastActiveAt,
  });
  const seen = (layout: CenterLayoutState, ids: string[]): CenterLayoutState => ({
    ...layout,
    seenSessionIds: ids,
  });

  it("keeps a done session's tab", () => {
    const layout = syncCloudSessionTabsInLayout(focusLeft(twoPanes()), [chat('s1', 'done')]);
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts'), session('s1')]);
  });

  it('drops the tab of a session no longer published', () => {
    const layout = syncCloudSessionTabsInLayout(focusLeft(twoPanes()), [chat('s2', 'done')]);
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts')]);
  });

  it('opens only the most recently active unseen chat, idle or not, without moving focus', () => {
    const layout = syncCloudSessionTabsInLayout(seen(focusLeft(twoPanes()), ['s1']), [
      chat('s1', 'active', at(12)),
      chat('s2', 'active', at(10)),
      chat('s3', 'suspended', at(11)),
      chat('s4', 'suspended', at(9)),
    ]);
    expect(findPane(layout, 'pane-0')).toMatchObject({
      tabs: [file('a.ts'), session('s3')],
      active: file('a.ts'),
    });
    expect(layout.seenSessionIds).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('never opens a done chat, even the latest', () => {
    const layout = syncCloudSessionTabsInLayout(seen(focusLeft(twoPanes()), ['s1']), [
      chat('s1', 'active'),
      chat('s2', 'done', at(12)),
      chat('s3', 'suspended', at(11)),
    ]);
    expect(findPane(layout, 'pane-0')?.tabs).toEqual([file('a.ts'), session('s3')]);
  });

  it('compares activity as instants, whatever the offset', () => {
    // 10:00+05:30 is 04:30Z, so s3 at 05:00Z is the later one.
    const layout = syncCloudSessionTabsInLayout(seen(focusLeft(twoPanes()), ['s1']), [
      chat('s1', 'active'),
      chat('s2', 'suspended', '2026-10-01T10:00:00+05:30'),
      chat('s3', 'suspended', '2026-10-01T05:00:00Z'),
    ]);
    expect(findPane(layout, 'pane-0')?.tabs).toEqual([file('a.ts'), session('s3')]);
  });

  it('opens nothing more when the latest unseen chat already has a tab', () => {
    const layout = syncCloudSessionTabsInLayout(focusLeft(twoPanes()), [
      chat('s1', 'suspended', at(12)),
      chat('s2', 'suspended', at(11)),
    ]);
    expect(findPane(layout, 'pane-0')?.tabs).toEqual([file('a.ts')]);
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts'), session('s1')]);
    expect(layout.seenSessionIds).toEqual(['s1', 's2']);
  });

  it('opens a lone conversation on first visit, as the owner view does', () => {
    const layout = syncCloudSessionTabsInLayout(EMPTY_CENTER_LAYOUT, [chat('s1', 'suspended')]);
    expect(getFocusedPane(layout)).toMatchObject({ tabs: [session('s1')], active: session('s1') });
  });

  it('leaves closed the tab of a chat the layout has already seen', () => {
    // The registry refetches on every agent turn, and the view remounts on
    // every visit; a chat the teammate closed must not reappear either way.
    const layout = syncCloudSessionTabsInLayout(seen(focusLeft(twoPanes()), ['s1', 's2']), [
      chat('s1', 'active'),
      chat('s2', 'active', at(12)),
    ]);
    expect(findPane(layout, 'pane-0')?.tabs).toEqual([file('a.ts')]);
    expect(findPane(layout, 'pane-1')?.tabs).toEqual([file('b.ts'), session('s1')]);
  });

  it('opens a chat published later once; closed, it stays closed', () => {
    const sessions = [chat('s1', 'active'), chat('s2', 'suspended')];
    const opened = syncCloudSessionTabsInLayout(seen(focusLeft(twoPanes()), ['s1']), sessions);
    expect(findPane(opened, 'pane-0')?.tabs).toEqual([file('a.ts'), session('s2')]);
    const closed = closeTabInLayout(opened, session('s2'));
    const synced = syncCloudSessionTabsInLayout(closed, sessions);
    expect(findPane(synced, 'pane-0')?.tabs).toEqual([file('a.ts')]);
  });

  it('returns the same layout when the registry refetches unchanged', () => {
    const sessions = [chat('s1', 'active'), chat('s2', 'suspended')];
    const once = syncCloudSessionTabsInLayout(focusLeft(twoPanes()), sessions);
    expect(syncCloudSessionTabsInLayout(once, sessions)).toBe(once);
  });

  // Decision 5: while the owner has published no chat, the item's whole chat is
  // the Work item chat tab.
  it('with no chat published, an empty pane opens the Work item chat and focuses it', () => {
    const layout = syncCloudSessionTabsInLayout(EMPTY_CENTER_LAYOUT, []);
    expect(getFocusedPane(layout)).toMatchObject({
      tabs: [ITEM_CHAT_TAB],
      active: ITEM_CHAT_TAB,
    });
  });

  it('with no chat published, a pane already showing something gains the tab, not focus', () => {
    const layout = syncCloudSessionTabsInLayout(focusLeft(twoPanes()), []);
    expect(findPane(layout, 'pane-0')).toMatchObject({
      tabs: [file('a.ts'), ITEM_CHAT_TAB],
      active: file('a.ts'),
    });
  });

  it('drops the Work item chat once a chat is published, which takes its place', () => {
    const itemChat = syncCloudSessionTabsInLayout(EMPTY_CENTER_LAYOUT, []);
    const layout = syncCloudSessionTabsInLayout(itemChat, [chat('s1', 'active')]);
    expect(getFocusedPane(layout)).toMatchObject({
      tabs: [session('s1')],
      active: session('s1'),
    });
  });

  it('returns the same layout while still no chat is published', () => {
    const once = syncCloudSessionTabsInLayout(EMPTY_CENTER_LAYOUT, []);
    expect(syncCloudSessionTabsInLayout(once, [])).toBe(once);
  });
});
