import {
  centerTabsEqual,
  isDocumentTab,
  ITEM_CHAT_TAB,
  type CenterTab,
  type StripTab,
} from './center-tab';
import {
  activateTab,
  closeTab,
  defaultActiveForSessions,
  EMPTY_CENTER_TABS,
  ensureSessionTabs,
  openTab,
  reconcileSessions,
  type CenterTabsState,
  type SessionTabSource,
} from './center-tabs-model';

export type SplitDirection = 'horizontal' | 'vertical';

/** One tab group. `active` is null in a pane with nothing open — it renders its empty state. */
export interface CenterPane {
  kind: 'pane';
  id: string;
  tabs: StripTab[];
  active: StripTab | null;
}

/** Two children side by side (`horizontal`) or stacked (`vertical`); `sizes` are percentages. */
export interface CenterSplit {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  children: [CenterLayoutNode, CenterLayoutNode];
  sizes: [number, number];
}

export type CenterLayoutNode = CenterPane | CenterSplit;

/**
 * One work item's centre layout. Pane and split ids come from `nextId` so the
 * tree stays deterministic. `sessionDefaultApplied` is item-wide: the
 * single-session auto-open fires once, whichever pane the user touched.
 * `seenSessionIds` is a teammate view's: the published chats it has already
 * synced, so a chat opens once and a closed tab stays closed on every visit
 * (`syncCloudSessionTabsInLayout`). The owner's view leaves it empty.
 */
export interface CenterLayoutState {
  root: CenterLayoutNode;
  focusedPaneId: string;
  nextId: number;
  sessionDefaultApplied: boolean;
  seenSessionIds: string[];
}

/** Splits nest at most this deep, so a centre holds at most four panes. */
export const MAX_SPLIT_DEPTH = 2;

export function createCenterLayout(state: CenterTabsState = EMPTY_CENTER_TABS): CenterLayoutState {
  return {
    root: { kind: 'pane', id: 'pane-0', tabs: state.tabs, active: state.active },
    focusedPaneId: 'pane-0',
    nextId: 1,
    sessionDefaultApplied: state.sessionDefaultApplied,
    seenSessionIds: [],
  };
}

export const EMPTY_CENTER_LAYOUT: CenterLayoutState = createCenterLayout();

export function listPanes(node: CenterLayoutNode): CenterPane[] {
  return node.kind === 'pane' ? [node] : node.children.flatMap(listPanes);
}

export function findPane(layout: CenterLayoutState, paneId: string): CenterPane | undefined {
  return listPanes(layout.root).find((pane) => pane.id === paneId);
}

export function getFocusedPane(layout: CenterLayoutState): CenterPane {
  const pane = findPane(layout, layout.focusedPaneId);
  if (!pane) throw new Error(`Focused centre pane ${layout.focusedPaneId} is not in the layout`);
  return pane;
}

export function focusPane(layout: CenterLayoutState, paneId: string): CenterLayoutState {
  if (layout.focusedPaneId === paneId || !findPane(layout, paneId)) return layout;
  return { ...layout, focusedPaneId: paneId };
}

/**
 * Runs a flat tab transition on one pane. A pane that loses its last tab
 * collapses into its sibling; the last pane standing has no sibling to
 * collapse into and stays, showing its empty state.
 */
export function updatePane(
  layout: CenterLayoutState,
  paneId: string,
  update: (state: CenterTabsState) => CenterTabsState
): CenterLayoutState {
  const pane = findPane(layout, paneId);
  if (!pane) return layout;
  // The pane as the flat tab model sees it, so its transitions apply unchanged.
  const { tabs, active: shown } = pane;
  const before = { tabs, active: shown, sessionDefaultApplied: layout.sessionDefaultApplied };
  const after = update(before);
  if (after === before) return layout;

  const touched = { ...layout, sessionDefaultApplied: after.sessionDefaultApplied };
  if (after.tabs.length === 0 && pane.tabs.length > 0) {
    const collapsed = collapsePane(touched, paneId);
    // `collapsePane` is a no-op for a pane with no sibling — the last one
    // standing. It keeps the emptied state instead, so the centre shows an
    // empty pane rather than the tabs it just lost.
    if (collapsed !== touched) return collapsed;
  }
  const root = replaceNode(layout.root, paneId, () => ({
    ...pane,
    tabs: after.tabs,
    active: after.active,
  }));
  return { ...touched, root };
}

export function updateFocusedPane(
  layout: CenterLayoutState,
  update: (state: CenterTabsState) => CenterTabsState
): CenterLayoutState {
  return updatePane(layout, layout.focusedPaneId, update);
}

export function updateEveryPane(
  layout: CenterLayoutState,
  update: (state: CenterTabsState) => CenterTabsState
): CenterLayoutState {
  return listPanes(layout.root).reduce((next, pane) => updatePane(next, pane.id, update), layout);
}

/**
 * Opens a tab where it belongs: a session in the pane already showing it (a
 * session lives in at most one pane), anything else in the focused pane.
 * Documents may be open in several panes.
 */
export function openTabInLayout(
  layout: CenterLayoutState,
  tab: CenterTab,
  { preview }: { preview: boolean }
): CenterLayoutState {
  const paneId = findPinnedPaneId(layout, tab) ?? layout.focusedPaneId;
  return updatePane(focusPane(layout, paneId), paneId, (s) => openTab(s, tab, { preview }));
}

/** Activates an open tab, preferring the focused pane, else the first pane holding it. */
export function activateTabInLayout(layout: CenterLayoutState, tab: CenterTab): CenterLayoutState {
  const holder = [getFocusedPane(layout), ...listPanes(layout.root)].find((pane) =>
    pane.tabs.some((t) => centerTabsEqual(t, tab))
  );
  if (!holder) return layout;
  return updatePane(focusPane(layout, holder.id), holder.id, (s) => activateTab(s, tab));
}

/** Closes a tab in one pane, or in every pane when `paneId` is omitted. */
export function closeTabInLayout(
  layout: CenterLayoutState,
  tab: StripTab,
  paneId?: string
): CenterLayoutState {
  if (paneId !== undefined) return updatePane(layout, paneId, (s) => closeTab(s, tab));
  return updateEveryPane(layout, (s) => closeTab(s, tab));
}

/** Sets a split's sizes, normalized to percentages; ignored unless both are positive. */
export function resizeSplit(
  layout: CenterLayoutState,
  splitId: string,
  sizes: [number, number]
): CenterLayoutState {
  if (!(sizes[0] > 0 && sizes[1] > 0)) return layout;
  const total = sizes[0] + sizes[1];
  const normalized: [number, number] = [(sizes[0] / total) * 100, (sizes[1] / total) * 100];
  const root = replaceNode(layout.root, splitId, (node) =>
    node.kind === 'split' ? { ...node, sizes: normalized } : node
  );
  return root === layout.root ? layout : { ...layout, root };
}

export function reconcileSessionsInLayout(
  layout: CenterLayoutState,
  liveSessionIds: ReadonlySet<string>
): CenterLayoutState {
  return updateEveryPane(layout, (s) => reconcileSessions(s, liveSessionIds));
}

/** `defaultActiveForSessions`, only while the centre is still a single pane. */
export function applySessionDefaultInLayout(
  layout: CenterLayoutState,
  chatSessionIds: readonly string[]
): CenterLayoutState {
  if (layout.root.kind !== 'pane') return layout;
  return updatePane(layout, layout.root.id, (s) => defaultActiveForSessions(s, chatSessionIds));
}

/**
 * The owner's session policy across panes. A done session keeps a tab it
 * already has (shared-items step 5, decision 5: the teammate's rule, so an
 * ended chat reopened from `+` or by a notification stays open until closed);
 * only a session that no longer exists loses its tab. An active session with
 * no tab in any pane gains one in the focused pane, and a lone resumable chat
 * opens on first visit; a done session never opens on its own. Closing a tab
 * removes it explicitly (`useWorkItemSessions.closeSession`).
 */
export function syncSessionTabsInLayout(
  layout: CenterLayoutState,
  sessions: readonly SessionTabSource[]
): CenterLayoutState {
  const notDone = sessions.filter((s) => s.status !== 'done');
  const chatIds = notDone.filter((s) => s.kind === 'chat').map((s) => s.id);
  const reconciled = reconcileSessionsInLayout(layout, new Set(sessions.map((s) => s.id)));
  const defaulted = applySessionDefaultInLayout(reconciled, chatIds);
  const open = new Set(
    listPanes(defaulted.root).flatMap((pane) =>
      pane.tabs.flatMap((t) => (t.kind === 'session' ? [t.sessionId] : []))
    )
  );
  const missing = notDone.filter((s) => s.status === 'active' && !open.has(s.id)).map((s) => s.id);
  if (missing.length === 0) return defaulted;
  return updateFocusedPane(defaulted, (s) => ensureSessionTabs(s, missing));
}

/** A published chat as a teammate's tabs need it: when it last saw activity. */
export interface CloudSessionTabSource extends SessionTabSource {
  /** ISO-8601 with offset, as the cloud registry sends it. */
  lastActiveAt: string;
}

/**
 * A teammate's session policy (shared-items step 4, decision 5; 8e decided
 * 2026-10-01): as the owner's (a done session keeps its tab, step 5), except
 * closing a tab never ends the owner's session. Only a session the owner no
 * longer publishes loses its tab. Of the chats the layout has not seen, the
 * most recently active one that is not done gains a tab, idle or not, and
 * focus stays put: a teammate arrives without the owner's context, so the
 * conversation is shown, but one tab at most so a busy item does not flood
 * the strip. Every published chat is then seen; the strip's `+` reaches the
 * rest, and a tab the teammate closed stays closed. While no chat is
 * published, the item's whole chat is the Work item chat tab (decision 5).
 */
export function syncCloudSessionTabsInLayout(
  layout: CenterLayoutState,
  sessions: readonly CloudSessionTabSource[]
): CenterLayoutState {
  const reconciled = reconcileSessionsInLayout(layout, new Set(sessions.map((s) => s.id)));
  const chatIds = sessions.filter((s) => s.kind === 'chat' && s.status !== 'done').map((s) => s.id);
  const defaulted = applySessionDefaultInLayout(reconciled, chatIds);
  const seen = new Set(layout.seenSessionIds);
  const latest = sessions
    .filter((s) => s.status !== 'done' && !seen.has(s.id))
    .reduce<
      CloudSessionTabSource | undefined
    >((best, s) => (best && Date.parse(best.lastActiveAt) >= Date.parse(s.lastActiveAt) ? best : s), undefined);
  const open = new Set(
    listPanes(defaulted.root).flatMap((pane) =>
      pane.tabs.flatMap((t) => (t.kind === 'session' ? [t.sessionId] : []))
    )
  );
  const opened =
    latest && !open.has(latest.id)
      ? updateFocusedPane(defaulted, (s) => ensureSessionTabs(s, [latest.id]))
      : defaulted;
  return withSeenSessions(
    syncItemChatTab(opened, sessions.length === 0),
    sessions.map((s) => s.id)
  );
}

/**
 * The Work item chat tab is there exactly while no chat is published: it opens
 * focused in an empty focused pane, or beside what that pane shows; once a
 * chat is published it closes, and the pane's focus moves to its neighbour,
 * which is the chat that took its place.
 */
function syncItemChatTab(layout: CenterLayoutState, noChatPublished: boolean): CenterLayoutState {
  const shown = listPanes(layout.root).some((pane) =>
    pane.tabs.some((tab) => tab.kind === 'item-chat')
  );
  if (!noChatPublished) return shown ? closeTabInLayout(layout, ITEM_CHAT_TAB) : layout;
  if (shown) return layout;
  if (getFocusedPane(layout).tabs.length === 0) {
    return updateFocusedPane(layout, (s) => openTab(s, ITEM_CHAT_TAB, { preview: false }));
  }
  return updateFocusedPane(layout, (s) => ({ ...s, tabs: [...s.tabs, ITEM_CHAT_TAB] }));
}

/** Records the seen ids, keeping the layout's identity when they did not change. */
function withSeenSessions(layout: CenterLayoutState, ids: string[]): CenterLayoutState {
  const same =
    ids.length === layout.seenSessionIds.length &&
    ids.every((id, i) => id === layout.seenSessionIds[i]);
  return same ? layout : { ...layout, seenSessionIds: ids };
}

/** The pane a tab is pinned to, if any: the one already showing that session or the item chat. */
function findPinnedPaneId(layout: CenterLayoutState, tab: CenterTab): string | undefined {
  if (isDocumentTab(tab)) return undefined;
  return listPanes(layout.root).find((pane) => pane.tabs.some((t) => centerTabsEqual(t, tab)))?.id;
}

/** Removes a pane, handing focus to the first pane of its sibling. */
export function collapsePane(layout: CenterLayoutState, paneId: string): CenterLayoutState {
  const sibling = findSibling(layout.root, paneId);
  if (!sibling) return layout;
  const fallback = listPanes(sibling)[0].id;
  return {
    ...layout,
    root: removePane(layout.root, paneId),
    focusedPaneId: layout.focusedPaneId === paneId ? fallback : layout.focusedPaneId,
  };
}

export function paneDepth(node: CenterLayoutNode, paneId: string, depth = 0): number {
  if (node.kind === 'pane') return node.id === paneId ? depth : -1;
  return Math.max(...node.children.map((child) => paneDepth(child, paneId, depth + 1)));
}

function findSibling(node: CenterLayoutNode, paneId: string): CenterLayoutNode | undefined {
  if (node.kind === 'pane') return undefined;
  const [a, b] = node.children;
  if (a.kind === 'pane' && a.id === paneId) return b;
  if (b.kind === 'pane' && b.id === paneId) return a;
  return findSibling(a, paneId) ?? findSibling(b, paneId);
}

function removePane(node: CenterLayoutNode, paneId: string): CenterLayoutNode {
  if (node.kind === 'pane') return node;
  const [a, b] = node.children;
  if (a.kind === 'pane' && a.id === paneId) return b;
  if (b.kind === 'pane' && b.id === paneId) return a;
  return withChildren(node, removePane(a, paneId), removePane(b, paneId));
}

/** Replaces the pane or split with id `id`, keeping untouched subtrees' identity. */
export function replaceNode(
  node: CenterLayoutNode,
  id: string,
  update: (node: CenterLayoutNode) => CenterLayoutNode
): CenterLayoutNode {
  if (node.id === id) return update(node);
  if (node.kind === 'pane') return node;
  const [a, b] = node.children;
  return withChildren(node, replaceNode(a, id, update), replaceNode(b, id, update));
}

/** Keeps the split's identity when neither child changed. */
function withChildren(split: CenterSplit, a: CenterLayoutNode, b: CenterLayoutNode): CenterSplit {
  if (a === split.children[0] && b === split.children[1]) return split;
  return { ...split, children: [a, b] };
}
