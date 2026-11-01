import type { ReactNode } from 'react';
import { getFocusedPane, type CenterPane as CenterPaneNode } from './center-layout';
import { CenterPane } from './center-pane';
import type { StripTab } from './center-tab';
import { CenterLayoutKeyProvider, useCenterLayout, usePaneTabs } from './center-tabs-store';
import { PaneHostProvider, participantLayoutKey, type PaneHost } from './pane-host';
import { RetainedBodyHost } from './retained-body-host';
import type { SessionTabModel } from './session-tab-model';
import { SplitContainer } from './split-container';
import { useCenterTabShortcuts } from './use-center-tab-shortcuts';
import { useWorkItemPresenceSender } from './use-viewing-presence';
import { presenceStateOf } from './viewing-presence-state';
import { WorkItemSourceProvider, type WorkItemSource } from './work-item-source';

const ownLayoutKey = (workItemId: string) => workItemId;

/**
 * A work item on screen, for every viewer (step 4, S8): header, the centre's
 * split panes, the retained chat and terminal bodies, and the rail. The
 * containers (`LocalWorkItemView`, `CloudWorkItemView`) supply the source,
 * the pane host and each slot; what is composed here is the same for both.
 *
 * Bodies are retained (`RetainedBodyHost`): scroll, drafts and streaming state
 * survive tab switches, splits and moves, and toggling the rail, which is why
 * the host wraps the rail too. The source sits above it, since the bodies read
 * it; `bodyProviders` adds what else they read (the owner's turn stream, the
 * teammate's chat feed).
 */
export function WorkItemView<Session extends SessionTabModel>({
  source,
  paneHost,
  header,
  banner,
  rail,
  sessionBodies,
  renderWorkItemChat,
  bodyProviders,
}: {
  source: WorkItemSource;
  paneHost: PaneHost;
  /** Given the focused pane's tab (Share preselects its artifact). */
  header: (focused: StripTab | null) => ReactNode;
  banner?: ReactNode;
  /** Given the focused pane's tab (the rail's changes list selects its diff). */
  rail: (focused: StripTab | null) => ReactNode;
  /** The session tabs' bodies: the owner's rows, or a teammate's chats (`paneHost.sessions`). */
  sessionBodies: { byId: ReadonlyMap<string, Session>; render: (session: Session) => ReactNode };
  /** A teammate's item chat, while the owner has published no chat. */
  renderWorkItemChat?: () => ReactNode;
  bodyProviders: (bodies: ReactNode) => ReactNode;
}) {
  if (paneHost.layoutKey !== source.layoutKey) {
    throw new Error('The pane host and the source must address one layout');
  }
  const layout = useCenterLayout(source.layoutKey);
  const { root, focusedPaneId } = layout.layout;
  const focused = getFocusedPane(layout.layout).active;
  const sessions = paneHost.sessions;

  // Only the focused pane answers tab shortcuts. Closing a session tab is the
  // view's close: the owner's ends the session, a teammate's closes the tab.
  // The Work item chat has no close: it goes once a chat is published.
  const focusedTabs = usePaneTabs(source.layoutKey, focusedPaneId);
  useCenterTabShortcuts({
    ...focusedTabs,
    close: (tab) => {
      if (tab.kind === 'item-chat') return;
      if (tab.kind === 'session' && sessions) sessions.close(tab.sessionId);
      else focusedTabs.close(tab);
    },
  });

  // One presence sender per view: the focused tab, a chat tab included. Its
  // room is the work item's, which an artifacts-only viewer never joins.
  useWorkItemPresenceSender(
    source.capabilities.workItemRoom ? source.workItemId : undefined,
    presenceStateOf(focused, (sessionId) => sessions?.byId.get(sessionId)?.kind)
  );

  const renderPane = (pane: CenterPaneNode) => (
    <CenterPane key={pane.id} pane={pane} showFocus={root.kind === 'split'} layout={layout} />
  );

  const center = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {header(focused)}
      {banner}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <PaneHostProvider value={paneHost}>
          <SplitContainer node={root} renderPane={renderPane} onResize={layout.resizeSplit} />
        </PaneHostProvider>
      </div>
    </div>
  );

  return (
    <WorkItemSourceProvider value={source}>
      {/* Rows that only know a work item id (artifact chips) find this view's layout. */}
      <CenterLayoutKeyProvider
        value={source.kind === 'local' ? ownLayoutKey : participantLayoutKey}
      >
        {bodyProviders(
          <RetainedBodyHost
            layout={layout.layout}
            renderWorkItemChat={renderWorkItemChat}
            sessions={sessionBodies}
          >
            {/* The rail owns its own width and open state, so it is a sibling
                of the centre rather than a half of a resizable split. */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{center}</div>
              {rail(focused)}
            </div>
          </RetainedBodyHost>
        )}
      </CenterLayoutKeyProvider>
    </WorkItemSourceProvider>
  );
}
