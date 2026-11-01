import type { CloudSession } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import {
  closeTabInLayout,
  EMPTY_CENTER_LAYOUT,
  getFocusedPane,
  openTabInLayout,
  syncCloudSessionTabsInLayout,
} from './center-layout';
import { splitPane } from './center-layout-split';
import type { StripTab } from './center-tab';
import { listCloudChatEntries } from './cloud-chat-launcher';

function cloudSession(overrides: Partial<CloudSession> = {}): CloudSession {
  return {
    id: 's1',
    work_item_id: 'wi-1',
    agent_provider_id: 'claude',
    title: null,
    status: 'active',
    worktree_id: null,
    last_active_at: '2026-09-17T10:00:00.000Z',
    updated_at: '2026-09-17T10:00:00.000Z',
    model_label: null,
    permission_mode_label: null,
    ...overrides,
  };
}

const tab = (id: string): StripTab => ({ kind: 'session', sessionId: id });

describe('listCloudChatEntries', () => {
  it('orders chats oldest-active first, so the menu does not reshuffle as agents work', () => {
    const entries = listCloudChatEntries(
      [
        cloudSession({ id: 'b', last_active_at: '2026-09-17T12:00:00.000Z' }),
        cloudSession({ id: 'a', last_active_at: '2026-09-17T09:00:00.000Z' }),
      ],
      EMPTY_CENTER_LAYOUT
    );
    expect(entries.map((e) => e.session.id)).toEqual(['a', 'b']);
  });

  it('marks the chats that have a tab in any pane', () => {
    const left = openTabInLayout(EMPTY_CENTER_LAYOUT, tab('a'), { preview: false });
    const layout = openTabInLayout(splitPane(left, 'pane-0', 'horizontal'), tab('b'), {
      preview: false,
    });
    const entries = listCloudChatEntries(
      [
        cloudSession({ id: 'a', last_active_at: '2026-09-17T09:00:00.000Z' }),
        cloudSession({ id: 'b', last_active_at: '2026-09-17T10:00:00.000Z' }),
        cloudSession({ id: 'c', last_active_at: '2026-09-17T11:00:00.000Z' }),
      ],
      layout
    );
    expect(entries.map((e) => [e.session.id, e.open])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ]);
  });

  it('marks a done chat as ended; a suspended one can come back', () => {
    const entries = listCloudChatEntries(
      [
        cloudSession({ id: 'a', status: 'done', last_active_at: '2026-09-17T09:00:00.000Z' }),
        cloudSession({ id: 'b', status: 'suspended', last_active_at: '2026-09-17T10:00:00.000Z' }),
      ],
      EMPTY_CENTER_LAYOUT
    );
    expect(entries.map((e) => [e.session.id, e.ended])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it("keeps a done chat's transcript reachable after the teammate closes its tab", () => {
    const at = '2026-09-17T09:00:00.000Z';
    const live = syncCloudSessionTabsInLayout(EMPTY_CENTER_LAYOUT, [
      { id: 's1', kind: 'chat', status: 'active', lastActiveAt: at },
    ]);
    const done = [{ id: 's1', kind: 'chat', status: 'done', lastActiveAt: at }];
    const ended = syncCloudSessionTabsInLayout(live, done);
    expect(getFocusedPane(ended).tabs).toEqual([tab('s1')]);

    const closed = syncCloudSessionTabsInLayout(closeTabInLayout(ended, tab('s1')), done);
    expect(getFocusedPane(closed).tabs).toEqual([]);

    const [entry] = listCloudChatEntries([cloudSession({ status: 'done' })], closed);
    expect(entry).toMatchObject({ session: { id: 's1' }, open: false, ended: true });
    const reopened = openTabInLayout(closed, tab(entry.session.id), { preview: false });
    expect(getFocusedPane(reopened)).toMatchObject({ tabs: [tab('s1')], active: tab('s1') });
  });
});
