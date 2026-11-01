import { getFocusedPane, listPanes, type CenterLayoutState } from './center-layout';
import { ITEM_CHAT_TAB, type StripTab } from './center-tab';

/** A chat as the reveal rule weighs it: the owner's session row or a published one. */
export interface RevealChat {
  id: string;
  kind: string;
  status: string;
  /** Any monotonic clock, compared only with other chats' (epoch seconds or ms). */
  lastActiveAt: number;
}

/**
 * The tab a revealed message opens in (shared-items step 5, decision 5).
 *
 * A message written in a chat opens that chat, ended or not. A row of no chat
 * is the item's history, shown in every chat, so the reader stays where they
 * are: the chat the focused pane shows, else the most recently active chat
 * with a tab, else the newest chat (one not ended first). While no chat is
 * published, the teammate's whole chat is the Work item chat tab. Null: the
 * viewer has no chat that holds it.
 */
export function chooseRevealTab({
  layout,
  sessionId,
  chats,
  itemChat,
}: {
  layout: CenterLayoutState;
  sessionId: string | null;
  chats: readonly RevealChat[];
  itemChat: boolean;
}): StripTab | null {
  if (itemChat) return ITEM_CHAT_TAB;
  const chatsById = new Map(chats.filter((c) => c.kind === 'chat').map((c) => [c.id, c]));
  if (sessionId !== null) {
    return chatsById.has(sessionId) ? sessionTab(sessionId) : null;
  }

  const focused = getFocusedPane(layout).active;
  if (focused?.kind === 'session' && chatsById.has(focused.sessionId)) return focused;

  const withTabs = listPanes(layout.root)
    .flatMap((pane) => pane.tabs)
    .flatMap((tab) => (tab.kind === 'session' ? [chatsById.get(tab.sessionId)] : []))
    .filter((chat): chat is RevealChat => chat !== undefined);
  const lastWithTab = newest(withTabs);
  if (lastWithTab) return sessionTab(lastWithTab.id);

  const all = [...chatsById.values()];
  const chat = newest(all.filter((c) => c.status !== 'done')) ?? newest(all);
  return chat ? sessionTab(chat.id) : null;
}

function sessionTab(sessionId: string): StripTab {
  return { kind: 'session', sessionId };
}

function newest(chats: readonly RevealChat[]): RevealChat | undefined {
  return chats.reduce<RevealChat | undefined>(
    (best, c) => (best && best.lastActiveAt >= c.lastActiveAt ? best : c),
    undefined
  );
}
