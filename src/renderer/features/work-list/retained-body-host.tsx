import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { CenterLayoutState } from './center-layout';
import { listRetainedBodies, WORK_ITEM_CHAT_BODY_KEY } from './retained-bodies';
import { RetainedPanel } from './retained-panel';
import type { SessionTabModel } from './session-tab-model';

const NO_SESSIONS: ReadonlyMap<string, never> = new Map<string, never>();

const BodyElementContext = createContext<((key: string) => HTMLElement) | null>(null);
/** The pane the work-item chat fills, or null when the view has none. */
const WorkItemChatPaneContext = createContext<string | null>(null);

/**
 * Renders every Room and session body once, outside the split tree, into a
 * detached element per body; each pane's `RetainedBodySlot` moves that
 * element into its body. Splitting, collapsing, or moving a tab across panes
 * then only moves DOM: the React subtree — transcript scroll, streaming
 * state, drafts, the terminal connection — is never remounted.
 *
 * Portaled bodies bubble React events to this host, not to their pane, so
 * pane-level focus and drop handling listen on the DOM (`usePaneDomEvents`).
 * The view supplies the bodies: its sessions, and for a teammate's item with
 * no chats yet, the work-item chat, which fills the first pane while nothing
 * is open there.
 */
export function RetainedBodyHost<Session extends SessionTabModel>({
  layout,
  renderWorkItemChat,
  sessions,
  children,
}: {
  layout: CenterLayoutState;
  /** A teammate's item chat, only while the owner has published no chat. */
  renderWorkItemChat?: () => ReactNode;
  /** The view's session tabs' bodies: the owner's sessions, or a teammate's chats. */
  sessions?: {
    byId: ReadonlyMap<string, Session>;
    render: (session: Session) => ReactNode;
  };
  children: ReactNode;
}) {
  // One element per body for the host's lifetime; a Map, not state updates, since
  // creating an element must not re-render.
  const [elements] = useState(() => new Map<string, HTMLElement>());
  const getBodyElement = useCallback(
    (key: string) => {
      const existing = elements.get(key);
      if (existing) return existing;
      const element = document.createElement('div');
      element.className = 'contents';
      element.dataset.retainedBody = key;
      elements.set(key, element);
      return element;
    },
    [elements]
  );
  const sessionsById: ReadonlyMap<string, Session> = sessions?.byId ?? NO_SESSIONS;
  const bodies = useMemo(
    () => listRetainedBodies(layout, sessionsById, { workItemChat: !!renderWorkItemChat }),
    [layout, sessionsById, renderWorkItemChat]
  );

  useEffect(() => {
    const live = new Set(bodies.map((body) => body.key));
    for (const [key, element] of elements) {
      if (live.has(key)) continue;
      element.remove();
      elements.delete(key);
    }
  }, [bodies, elements]);

  const workItemChatPaneId =
    bodies.find((body) => body.key === WORK_ITEM_CHAT_BODY_KEY)?.paneId ?? null;

  return (
    <BodyElementContext.Provider value={getBodyElement}>
      <WorkItemChatPaneContext.Provider value={workItemChatPaneId}>
        {children}
      </WorkItemChatPaneContext.Provider>
      {/* After `children`, so the slots have attached each element before the bodies' layout effects run. */}
      {bodies.map((body) =>
        createPortal(
          <RetainedPanel active={body.active} focused={body.focused}>
            {body.session === null ? renderWorkItemChat?.() : sessions?.render(body.session)}
          </RetainedPanel>,
          getBodyElement(body.key),
          body.key
        )
      )}
    </BodyElementContext.Provider>
  );
}

/** The pane that shows the work-item chat, if the view has one (`listRetainedBodies`). */
export function useWorkItemChatPaneId(): string | null {
  return useContext(WorkItemChatPaneContext);
}

/** Where a pane shows one retained body: the host's element for `bodyKey` is moved in here. */
export function RetainedBodySlot({ bodyKey }: { bodyKey: string }) {
  const getBodyElement = useContext(BodyElementContext);
  if (!getBodyElement) throw new Error('RetainedBodySlot must be rendered inside RetainedBodyHost');
  const attach = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot) slot.appendChild(getBodyElement(bodyKey));
    },
    [getBodyElement, bodyKey]
  );
  return <div ref={attach} className="contents" />;
}
