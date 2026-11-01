import { listPanes, type CenterLayoutState } from './center-layout';

/** One retained body, and where the layout currently shows it. */
export interface RetainedBody<Session> {
  /** Stable across panes: `session:<id>`, or `work-item-chat`. */
  key: string;
  paneId: string;
  /** Null for the work-item chat, which belongs to no session. */
  session: Session | null;
  /** The active tab of its pane. */
  active: boolean;
  /** Its pane is the focused one. */
  focused: boolean;
}

export function sessionBodyKey(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * A teammate's chat for an item whose owner has published no chat yet: the
 * item's whole conversation, the body of the Work item chat tab (decision 5).
 * Once chats exist, each is a session tab instead.
 */
export const WORK_ITEM_CHAT_BODY_KEY = 'work-item-chat';

/**
 * Every body the centre keeps mounted: each session tab whose row is known, in
 * pane order. Keys don't depend on the pane, so a body keeps its identity when
 * its tab moves or the tree reshapes.
 */
export function listRetainedBodies<Session>(
  layout: CenterLayoutState,
  sessionsById: ReadonlyMap<string, Session>,
  { workItemChat = false }: { workItemChat?: boolean } = {}
): RetainedBody<Session>[] {
  const bodies: RetainedBody<Session>[] = [];
  const panes = listPanes(layout.root);
  const itemChatPane = workItemChat
    ? panes.find((pane) => pane.tabs.some((tab) => tab.kind === 'item-chat'))
    : undefined;
  if (itemChatPane) {
    bodies.push({
      key: WORK_ITEM_CHAT_BODY_KEY,
      paneId: itemChatPane.id,
      session: null,
      active: itemChatPane.active?.kind === 'item-chat',
      focused: itemChatPane.id === layout.focusedPaneId,
    });
  }
  for (const pane of panes) {
    const focused = pane.id === layout.focusedPaneId;
    for (const tab of pane.tabs) {
      const session = tab.kind === 'session' ? sessionsById.get(tab.sessionId) : undefined;
      if (tab.kind !== 'session' || session === undefined) continue;
      bodies.push({
        key: sessionBodyKey(tab.sessionId),
        paneId: pane.id,
        session,
        active: pane.active?.kind === 'session' && pane.active.sessionId === tab.sessionId,
        focused,
      });
    }
  }
  return bodies;
}
