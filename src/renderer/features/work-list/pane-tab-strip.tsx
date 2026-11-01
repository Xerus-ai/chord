import type { ReactNode } from 'react';
import { labelAgentSession } from '@shared/agent-session-label';
import { TabStrip } from '@renderer/lib/components/chrome/chrome-tabs';
import { distinguishLabels } from '@renderer/lib/distinguishing-labels';
import { ContextMenuItem, ContextMenuSeparator } from '@renderer/lib/ui/context-menu';
import type { CenterPane } from './center-layout';
import type { MoveTabRequest } from './center-layout-split';
import { canSplitPaneWidth, measurePaneWidth } from './center-pane-width';
import { centerTabKey, isDocumentTab, type DocumentTab, type StripTab } from './center-tab';
import type { CenterLayoutController, PaneTabsController } from './center-tabs-store';
import { DocumentStripTab } from './document-tabs';
import {
  encodeTabDrag,
  isTabDrag,
  readTabDrag,
  stripDropToMove,
  TAB_DRAG_TYPE,
  type TabDragPayload,
} from './pane-drop-zone';
import { isTabOffered, usePaneHost } from './pane-host';
import { ItemChatStripTab, SessionStripTab } from './session-strip-tab';

/**
 * Native HTML5 drag source and strip drop target around one tab. The wrapper
 * owns the divider, since the tab inside is always its wrapper's last child.
 */
function DraggableTab({
  payload,
  toIndex,
  onMove,
  children,
}: {
  payload: TabDragPayload;
  toIndex: number;
  onMove: (move: MoveTabRequest) => void;
  children: ReactNode;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_DRAG_TYPE, encodeTabDrag(payload));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        const dragged = readTabDrag(e);
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();
        onMove(stripDropToMove(dragged, payload.fromPaneId, toIndex));
      }}
      // Tabs size to their label (capped by --tab-max-width) and the rail
      // scrolls once they outgrow it, so the wrapper never shrinks.
      className="flex shrink-0 items-center"
    >
      {children}
    </div>
  );
}

function PaneTabMenu({
  tab,
  paneId,
  layout,
}: {
  tab: StripTab;
  paneId: string;
  layout: CenterLayoutController;
}) {
  // The store refuses a side-by-side split that cannot give both halves
  // PANE_MIN_WIDTH. Say so here, where the user asked, rather than letting the
  // item look live and do nothing. The menu mounts on open, so this measures
  // the pane as it is now.
  const canSplitSideBySide = canSplitPaneWidth(measurePaneWidth(paneId), 'horizontal');
  const tooNarrow = canSplitSideBySide ? null : (
    <span className="ml-auto pl-4 text-tiny tracking-tiny">Pane too narrow</span>
  );

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!canSplitSideBySide}
        onClick={() => layout.splitPane(paneId, 'horizontal', tab, 'before')}
      >
        Split Left
        {tooNarrow}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!canSplitSideBySide}
        onClick={() => layout.splitPane(paneId, 'horizontal', tab)}
      >
        Split Right
        {tooNarrow}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => layout.splitPane(paneId, 'vertical', tab, 'before')}>
        Split Up
      </ContextMenuItem>
      <ContextMenuItem onClick={() => layout.splitPane(paneId, 'vertical', tab)}>
        Split Down
      </ContextMenuItem>
      <ContextMenuItem onClick={() => layout.openToSide(tab)}>Open to the Side</ContextMenuItem>
    </>
  );
}

/**
 * One centre pane's strip: the pinned Room (room pane only), then the pane's
 * sessions and documents in stored order, then the launcher when the view has
 * local sessions. Only tabs the view's `PaneHost` offers are shown. Tabs drag
 * to reorder here or move to another pane's strip; a drop past the last tab
 * appends.
 */
export function PaneTabStrip({
  pane,
  controller,
  layout,
}: {
  pane: CenterPane;
  controller: PaneTabsController;
  layout: CenterLayoutController;
}) {
  const host = usePaneHost();
  const { sessions, missingArtifactIds } = host;
  const { active } = controller;
  const documentTabs = pane.tabs.filter(
    (tab): tab is DocumentTab => isDocumentTab(tab) && isTabOffered(host, tab)
  );
  const activeSession =
    active?.kind === 'session' ? sessions?.byId.get(active.sessionId) : undefined;
  // Side by side, sessions titled alike start where they differ (devstation-6w3p).
  const sessionRows = pane.tabs.flatMap((tab) => {
    const row =
      tab.kind === 'session' && isTabOffered(host, tab) ? sessions?.byId.get(tab.sessionId) : null;
    return row ? [row] : [];
  });
  const labels = distinguishLabels(sessionRows.map((row) => labelAgentSession(row)));
  const shownLabels = new Map(sessionRows.map((row, index) => [row.id, labels[index]]));
  const moveTab = layout.moveTab;

  return (
    <div
      className="flex h-9 shrink-0 items-stretch border-b border-border bg-surface"
      onDragOver={(e) => {
        if (isTabDrag(e)) e.preventDefault();
      }}
      onDrop={(e) => {
        const dragged = readTabDrag(e);
        if (!dragged) return;
        e.preventDefault();
        moveTab(stripDropToMove(dragged, pane.id, pane.tabs.length));
      }}
    >
      <TabStrip trailing={sessions?.renderLauncher(activeSession?.worktreeId ?? null)}>
        {pane.tabs.map((tab, index) => {
          if (!isTabOffered(host, tab)) return null;
          const key = centerTabKey(tab);
          const menu = <PaneTabMenu tab={tab} paneId={pane.id} layout={layout} />;
          let body: ReactNode;
          if (tab.kind === 'session') {
            const row = sessions?.byId.get(tab.sessionId);
            if (!sessions || !row) return null;
            const shownLabel = shownLabels.get(row.id);
            if (shownLabel === undefined) throw new Error(`No label for session tab ${row.id}`);
            body = (
              <SessionStripTab
                session={row}
                shownLabel={shownLabel}
                active={active?.kind === 'session' && active.sessionId === row.id}
                onActivate={() => controller.activate(tab)}
                onClose={() => sessions.close(row.id)}
                extraMenu={menu}
              />
            );
          } else if (tab.kind === 'item-chat') {
            body = (
              <ItemChatStripTab
                active={active?.kind === 'item-chat'}
                onActivate={() => controller.activate(tab)}
                extraMenu={menu}
              />
            );
          } else {
            body = (
              <DocumentStripTab
                tab={tab}
                index={documentTabs.indexOf(tab)}
                count={documentTabs.length}
                controller={controller}
                missing={
                  tab.kind === 'path' &&
                  tab.artifactId !== undefined &&
                  missingArtifactIds.has(tab.artifactId)
                }
                extraMenu={menu}
              />
            );
          }
          return (
            <DraggableTab
              key={key}
              payload={{ key, fromPaneId: pane.id }}
              toIndex={index}
              onMove={moveTab}
            >
              {body}
            </DraggableTab>
          );
        })}
      </TabStrip>
    </div>
  );
}
