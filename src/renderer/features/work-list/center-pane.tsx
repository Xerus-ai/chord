import { cn } from '@renderer/utils/utils';
import type { CenterPane as CenterPaneNode } from './center-layout';
import { isDocumentTab } from './center-tab';
import { openTab } from './center-tabs-model';
import { usePaneTabs, type CenterLayoutController } from './center-tabs-store';
import type { PaneDropZone } from './pane-drop-zone';
import { selectDocumentBody, usePaneHost } from './pane-host';
import { PaneTabStrip } from './pane-tab-strip';
import { sessionBodyKey, WORK_ITEM_CHAT_BODY_KEY } from './retained-bodies';
import { RetainedBodySlot, useWorkItemChatPaneId } from './retained-body-host';
import { usePaneDomEvents } from './use-pane-dom-events';

/** Where an edge drop will put the new pane, drawn over the body while dragging. */
const DROP_ZONE_CLASS: Record<PaneDropZone, string> = {
  center: 'inset-0',
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
};

export interface CenterPaneProps {
  pane: CenterPaneNode;
  /** Draws the focus marker; only meaningful once the centre is split. */
  showFocus: boolean;
  layout: CenterLayoutController;
}

/**
 * One tab group: its strip and bodies, supplied by the view's `PaneHost`.
 * Session and work-item chat bodies live in the view's `RetainedBodyHost` and are only
 * slotted in here, so they survive tab switches and splits, collapses and
 * moves; a session lives in one pane only. Documents unmount when hidden. Any
 * press inside focuses the pane, so launcher opens and shortcuts target it.
 * Tabs dropped on the body append, or split the pane when dropped on one of
 * its edges.
 */
export function CenterPane({ pane, showFocus, layout }: CenterPaneProps) {
  const host = usePaneHost();
  const controller = usePaneTabs(host.layoutKey, pane.id);
  const { rootRef, bodyRef, dropZone } = usePaneDomEvents(pane.id, {
    onFocus: () => layout.focusPane(pane.id),
    onMove: layout.moveTab,
  });
  const { active } = pane;
  const sessionsById = host.sessions?.byId;
  const paneSessionIds = sessionsById
    ? pane.tabs.flatMap((tab) =>
        tab.kind === 'session' && sessionsById.has(tab.sessionId) ? [tab.sessionId] : []
      )
    : [];
  const focused = layout.layout.focusedPaneId === pane.id;
  const holdsWorkItemChat = useWorkItemChatPaneId() === pane.id;

  return (
    <div
      ref={rootRef}
      data-pane-id={pane.id}
      className={cn(
        'flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        showFocus && 'border-t-2',
        showFocus && (focused ? 'border-selected-border' : 'border-transparent')
      )}
    >
      <PaneTabStrip pane={pane} controller={controller} layout={layout} />
      <div ref={bodyRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {holdsWorkItemChat && <RetainedBodySlot bodyKey={WORK_ITEM_CHAT_BODY_KEY} />}
        {paneSessionIds.map((sessionId) => (
          <RetainedBodySlot key={sessionId} bodyKey={sessionBodyKey(sessionId)} />
        ))}
        {active !== null &&
          selectDocumentBody(host, active, {
            onDocumentTouched: () => {
              if (isDocumentTab(active)) controller.promote(active);
            },
            onClose: () => {
              if (isDocumentTab(active)) layout.closeTab(pane.id, active);
            },
            onModeChange: (mode) => {
              if (active.kind !== 'path') return;
              layout.updatePane(pane.id, (state) =>
                openTab(state, { ...active, mode }, { preview: active.isPreview ?? false })
              );
            },
          })}
        {pane.tabs.length === 0 && !holdsWorkItemChat && (
          <div className="flex flex-1 items-center justify-center text-body tracking-body text-text-passive">
            {host.sessions?.emptyLabel ?? 'Drag a tab here'}
          </div>
        )}
        {dropZone && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute z-30 rounded-sm border border-selected-border bg-surface-inset/60',
              DROP_ZONE_CLASS[dropZone]
            )}
          />
        )}
      </div>
    </div>
  );
}
