import {
  closeTabInLayout,
  findPane,
  focusPane,
  listPanes,
  MAX_SPLIT_DEPTH,
  paneDepth,
  replaceNode,
  updatePane,
  type CenterLayoutState,
  type CenterPane,
  type CenterSplit,
  type SplitDirection,
} from './center-layout';
import { centerTabKey, centerTabsEqual, isDocumentTab, type StripTab } from './center-tab';
import { activateTab, closeTab, moveTab, openTab } from './center-tabs-model';

/** Which side of the split pane the new pane takes: left/top (`before`) or right/bottom (`after`). */
export type SplitSide = 'before' | 'after';

/**
 * Adds a pane beside `paneId` and focuses it, holding `tab` if given (moved
 * out of any other pane when it is a session) or empty for the launcher.
 * Unchanged when the pane already sits at `MAX_SPLIT_DEPTH`.
 */
export function splitPane(
  layout: CenterLayoutState,
  paneId: string,
  direction: SplitDirection,
  tab?: StripTab,
  side: SplitSide = 'after'
): CenterLayoutState {
  if (!findPane(layout, paneId) || paneDepth(layout.root, paneId) >= MAX_SPLIT_DEPTH) return layout;
  const cleared = tab && !isDocumentTab(tab) ? closeTabInLayout(layout, tab) : layout;
  const pane = findPane(cleared, paneId);
  // Moving a pane's only session out collapses that pane; there is nothing left to split.
  if (!pane) return layout;
  const newPane: CenterPane = {
    kind: 'pane',
    id: `pane-${cleared.nextId}`,
    tabs: tab ? [tab] : [],
    active: tab ?? null,
  };
  const split: CenterSplit = {
    kind: 'split',
    id: `split-${cleared.nextId + 1}`,
    direction,
    children: side === 'before' ? [newPane, pane] : [pane, newPane],
    sizes: [50, 50],
  };
  return {
    ...cleared,
    root: replaceNode(cleared.root, paneId, () => split),
    focusedPaneId: newPane.id,
    nextId: cleared.nextId + 2,
  };
}

/** Opens a tab in the next pane over, splitting the focused pane when it is alone. */
export function openToSide(
  layout: CenterLayoutState,
  tab: StripTab,
  { preview }: { preview: boolean }
): CenterLayoutState {
  const panes = listPanes(layout.root);
  if (panes.length === 1) return splitPane(layout, layout.focusedPaneId, 'horizontal', tab);
  const index = panes.findIndex((pane) => pane.id === layout.focusedPaneId);
  const target = panes[(index + 1) % panes.length].id;
  const cleared = !isDocumentTab(tab) ? closeTabInLayout(layout, tab) : layout;
  const paneId = findPane(cleared, target) ? target : cleared.focusedPaneId;
  return updatePane(focusPane(cleared, paneId), paneId, (s) => openTab(s, tab, { preview }));
}

export interface MoveTabRequest {
  /** `centerTabKey` of the dragged tab; `'chat'` moves the Room. */
  key: string;
  fromPaneId: string;
  toPaneId: string;
  /** Position in the target strip; ignored when splitting. */
  toIndex?: number;
  /** Dropped on a pane edge: create a pane beside `toPaneId` in this direction. */
  split?: SplitDirection;
  /** Which side of `toPaneId` the split's new pane takes; `after` when omitted. */
  side?: SplitSide;
}

/** Drag and drop: reorder within a pane, move across panes, or drop on an edge to split. */
export function moveTabInLayout(
  layout: CenterLayoutState,
  move: MoveTabRequest
): CenterLayoutState {
  const source = findPane(layout, move.fromPaneId);
  const tab = source?.tabs.find((t) => centerTabKey(t) === move.key);
  if (!source || !tab || !findPane(layout, move.toPaneId)) return layout;
  const moved: StripTab = isDocumentTab(tab) ? { ...tab, isPreview: false } : tab;

  if (move.split) {
    if (source.id === move.toPaneId && source.tabs.length === 1) return layout;
    const split = splitPane(layout, move.toPaneId, move.split, undefined, move.side);
    if (split === layout) return layout;
    const target = split.focusedPaneId;
    const withTab = updatePane(split, target, (s) => openTab(s, moved, { preview: false }));
    return focusPane(
      updatePane(withTab, source.id, (s) => closeTab(s, tab)),
      target
    );
  }

  if (source.id === move.toPaneId) {
    return updatePane(layout, source.id, (s) =>
      moveTab(s, move.key, move.toIndex ?? s.tabs.length)
    );
  }
  const removed = updatePane(layout, source.id, (s) => closeTab(s, tab));
  const inserted = updatePane(removed, move.toPaneId, (s) => {
    const existing = s.tabs.find((t) => centerTabsEqual(t, tab));
    if (existing) return activateTab(s, existing);
    const tabs = s.tabs.slice();
    tabs.splice(Math.max(0, Math.min(move.toIndex ?? tabs.length, tabs.length)), 0, moved);
    return { ...s, tabs, active: moved, sessionDefaultApplied: true };
  });
  return focusPane(inserted, move.toPaneId);
}
