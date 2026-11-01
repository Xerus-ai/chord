import type { CloudSession } from '@chord/protocol';
import { listPanes, type CenterLayoutState } from './center-layout';
import { cloudSessionTabModel, type SessionTabModel } from './session-tab-model';

/** One of the owner's chats in a teammate's `+` menu. */
export interface CloudChatEntry {
  session: SessionTabModel;
  /** It has a tab in some pane; choosing it brings that tab forward. */
  open: boolean;
  /**
   * The session is over and takes no more messages. Not the same as
   * suspended, which the owner's resume path can revive.
   */
  ended: boolean;
}

/**
 * A teammate's `+`: every chat the owner publishes, done ones included, so a
 * chat whose tab was closed is always one click from its transcript (a
 * teammate cannot start a chat, only reopen one). Oldest-active first:
 * ordering by latest activity would reshuffle the menu every time an agent
 * spoke; ascending appends new chats at the end, where they stay.
 */
export function listCloudChatEntries(
  sessions: readonly CloudSession[],
  layout: CenterLayoutState
): CloudChatEntry[] {
  const open = new Set(
    listPanes(layout.root).flatMap((pane) =>
      pane.tabs.flatMap((tab) => (tab.kind === 'session' ? [tab.sessionId] : []))
    )
  );
  return [...sessions]
    .sort((a, b) => Date.parse(a.last_active_at) - Date.parse(b.last_active_at))
    .map((session) => ({
      session: cloudSessionTabModel(session),
      open: open.has(session.id),
      ended: session.status === 'done',
    }));
}
