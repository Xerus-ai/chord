import { describe, expect, it } from 'vitest';
import { EMPTY_CENTER_LAYOUT, openTabInLayout, type CenterLayoutState } from './center-layout';
import { splitPane } from './center-layout-split';
import { filePathTab, ITEM_CHAT_TAB, type CenterTab, type StripTab } from './center-tab';
import { chooseRevealTab, type RevealChat } from './reveal-tab';

const session = (id: string): StripTab => ({ kind: 'session', sessionId: id });

function open(layout: CenterLayoutState, ...tabs: CenterTab[]): CenterLayoutState {
  return tabs.reduce((l, tab) => openTabInLayout(l, tab, { preview: false }), layout);
}

function chat(id: string, lastActiveAt: number, status = 'suspended', kind = 'chat'): RevealChat {
  return { id, kind, status, lastActiveAt };
}

const CHATS = [chat('s-old', 100), chat('s-new', 300), chat('s-mid', 200)];

/**
 * Which tab a revealed message opens in (shared-items step 5, decision 5): the
 * chat it was written in; a row of no chat (work-item history, shown in every
 * chat) where the reader already is, else the chat they were last in.
 */
describe('chooseRevealTab', () => {
  it('opens the chat the message was written in', () => {
    expect(
      chooseRevealTab({
        layout: EMPTY_CENTER_LAYOUT,
        sessionId: 's-old',
        chats: CHATS,
        itemChat: false,
      })
    ).toEqual(session('s-old'));
  });

  it('opens an ended chat too: it is reopened, not skipped', () => {
    expect(
      chooseRevealTab({
        layout: EMPTY_CENTER_LAYOUT,
        sessionId: 's-done',
        chats: [...CHATS, chat('s-done', 50, 'done')],
        itemChat: false,
      })
    ).toEqual(session('s-done'));
  });

  it('has no tab for a chat this viewer cannot open', () => {
    expect(
      chooseRevealTab({
        layout: EMPTY_CENTER_LAYOUT,
        sessionId: 's-unpublished',
        chats: CHATS,
        itemChat: false,
      })
    ).toBeNull();
  });

  it('a terminal is not a chat', () => {
    expect(
      chooseRevealTab({
        layout: EMPTY_CENTER_LAYOUT,
        sessionId: 't1',
        chats: [chat('t1', 400, 'active', 'terminal')],
        itemChat: false,
      })
    ).toBeNull();
  });

  it('with no chat published, everything is in the Work item chat', () => {
    expect(
      chooseRevealTab({
        layout: EMPTY_CENTER_LAYOUT,
        sessionId: 's-anything',
        chats: [],
        itemChat: true,
      })
    ).toEqual(ITEM_CHAT_TAB);
    expect(
      chooseRevealTab({ layout: EMPTY_CENTER_LAYOUT, sessionId: null, chats: [], itemChat: true })
    ).toEqual(ITEM_CHAT_TAB);
  });

  describe('a row of no chat', () => {
    it('stays in the chat the focused pane shows', () => {
      const layout = open(EMPTY_CENTER_LAYOUT, session('s-new'), session('s-old'));
      expect(chooseRevealTab({ layout, sessionId: null, chats: CHATS, itemChat: false })).toEqual(
        session('s-old')
      );
    });

    it('else opens the most recently active chat that has a tab', () => {
      const left = open(EMPTY_CENTER_LAYOUT, filePathTab('a.ts'));
      const layout = open(
        splitPane(left, 'pane-0', 'horizontal'),
        session('s-old'),
        session('s-mid'),
        filePathTab('b.ts')
      );
      expect(chooseRevealTab({ layout, sessionId: null, chats: CHATS, itemChat: false })).toEqual(
        session('s-mid')
      );
    });

    it('skips a terminal in focus', () => {
      const layout = open(EMPTY_CENTER_LAYOUT, session('s-old'), session('t1'));
      expect(
        chooseRevealTab({
          layout,
          sessionId: null,
          chats: [...CHATS, chat('t1', 900, 'active', 'terminal')],
          itemChat: false,
        })
      ).toEqual(session('s-old'));
    });

    it('else opens the newest chat that has not ended', () => {
      expect(
        chooseRevealTab({
          layout: open(EMPTY_CENTER_LAYOUT, filePathTab('a.ts')),
          sessionId: null,
          chats: [...CHATS, chat('s-ended', 999, 'done')],
          itemChat: false,
        })
      ).toEqual(session('s-new'));
    });

    it('else the newest ended chat', () => {
      expect(
        chooseRevealTab({
          layout: EMPTY_CENTER_LAYOUT,
          sessionId: null,
          chats: [chat('s-a', 10, 'done'), chat('s-b', 20, 'done')],
          itemChat: false,
        })
      ).toEqual(session('s-b'));
    });

    it('has no tab when the viewer has no chat at all', () => {
      expect(
        chooseRevealTab({
          layout: EMPTY_CENTER_LAYOUT,
          sessionId: null,
          chats: [],
          itemChat: false,
        })
      ).toBeNull();
    });
  });
});
