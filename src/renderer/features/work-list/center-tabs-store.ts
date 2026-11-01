import { createContext, useContext, useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  activateTabInLayout,
  applySessionDefaultInLayout,
  closeTabInLayout,
  EMPTY_CENTER_LAYOUT,
  findPane,
  focusPane,
  getFocusedPane,
  listPanes,
  openTabInLayout,
  reconcileSessionsInLayout,
  resizeSplit,
  syncSessionTabsInLayout,
  updateEveryPane,
  updateFocusedPane,
  updatePane,
  type CenterLayoutState,
  type SplitDirection,
} from './center-layout';
import {
  moveTabInLayout,
  openToSide,
  splitPane,
  type MoveTabRequest,
  type SplitSide,
} from './center-layout-split';
import { canSplitPaneWidth, measurePaneWidth } from './center-pane-width';
import type { CenterTab, DocumentTab, StripTab } from './center-tab';
import {
  migrateFlatStripsToV3,
  migrateLayoutsToV4,
  migrateLayoutsToV5,
} from './center-tabs-migration';
import {
  activateTab,
  closeAllTabs,
  closeOtherTabs,
  closeTabsToLeft,
  closeTabsToRight,
  moveTab,
  normalizePathTabs,
  promoteTab,
  pruneTabs,
  type CenterTabsState,
  type PathTabArtifact,
  type SessionTabSource,
} from './center-tabs-model';

interface CenterTabsStore {
  layouts: Record<string, CenterLayoutState>;
  applyLayout: (
    workItemId: string,
    update: (layout: CenterLayoutState) => CenterLayoutState
  ) => void;
}

const CENTER_TABS_VERSION = 5;

/**
 * Upgrades persisted centre tabs. v2 added session tabs and
 * `sessionDefaultApplied` (stale session tabs are dropped live by
 * `useReconcileCenterTabs`, not here); v3 stores a split-pane tree, and a flat
 * strip becomes a one-pane tree; v4 turns file, diff and artifact tabs into
 * path tabs; v5 adds a teammate view's `seenSessionIds`.
 */
export function migrateCenterTabs(
  persisted: unknown,
  version: number
): Pick<CenterTabsStore, 'layouts'> {
  if (version >= CENTER_TABS_VERSION) return persisted as Pick<CenterTabsStore, 'layouts'>;
  if (version === 4) {
    return { layouts: migrateLayoutsToV5((persisted as Pick<CenterTabsStore, 'layouts'>).layouts) };
  }
  if (version === 3) {
    const { layouts } = persisted as Pick<CenterTabsStore, 'layouts'>;
    return { layouts: migrateLayoutsToV5(migrateLayoutsToV4(layouts)) };
  }
  return { layouts: migrateLayoutsToV5(migrateLayoutsToV4(migrateFlatStripsToV3(persisted))) };
}

/**
 * Centre layout per work item, persisted so a work item comes back with the
 * panes, files, artifacts, and sessions it was left with. Client-only state
 * (Zustand, per the renderer state rule); the transitions live in
 * `center-layout.ts` and, per pane, `center-tabs-model.ts`.
 */
export const useCenterTabsStore = create<CenterTabsStore>()(
  persist(
    (set) => ({
      layouts: {},
      applyLayout: (workItemId, update) =>
        set((store) => {
          const current = store.layouts[workItemId] ?? EMPTY_CENTER_LAYOUT;
          const next = update(current);
          if (next === current) return store;
          return { layouts: { ...store.layouts, [workItemId]: next } };
        }),
    }),
    {
      name: 'chord:center-tabs',
      version: CENTER_TABS_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: migrateCenterTabs,
    }
  )
);

export interface OpenTabOptions {
  /** A preview tab: replaced by the next preview until promoted. */
  preview?: boolean;
}

/** Imperative entry point for callers outside a work item's tree (command palette). */
export function openCenterTab(workItemId: string, tab: CenterTab, options?: OpenTabOptions): void {
  useCenterTabsStore
    .getState()
    .applyLayout(workItemId, (layout) =>
      openTabInLayout(layout, tab, { preview: options?.preview ?? false })
    );
}

/** Imperative transition on the focused pane, for callbacks that must not re-bind on every tab change. */
export function updateCenterTabs(
  workItemId: string,
  update: (state: CenterTabsState) => CenterTabsState
): void {
  useCenterTabsStore
    .getState()
    .applyLayout(workItemId, (layout) => updateFocusedPane(layout, update));
}

/** Imperative layout transition (split, move, resize) for callbacks outside React state. */
export function updateCenterLayout(
  workItemId: string,
  update: (layout: CenterLayoutState) => CenterLayoutState
): void {
  useCenterTabsStore.getState().applyLayout(workItemId, update);
}

/** Closes a tab in whichever panes hold it, e.g. a session that just ended. */
export function closeCenterTab(workItemId: string, tab: StripTab): void {
  updateCenterLayout(workItemId, (layout) => closeTabInLayout(layout, tab));
}

function useLayout(workItemId: string): CenterLayoutState {
  return useCenterTabsStore((store) => store.layouts[workItemId] ?? EMPTY_CENTER_LAYOUT);
}

const openTabsByLayout = new WeakMap<CenterLayoutState, StripTab[]>();

/**
 * Every tab open in any pane of the item, e.g. to mark artifacts that already
 * have a tab. Cached per layout object so a Zustand selector gets the same
 * array back until the layout changes.
 */
export function selectOpenCenterTabs(
  store: Pick<CenterTabsStore, 'layouts'>,
  workItemId: string | undefined
): StripTab[] | undefined {
  const layout = workItemId ? store.layouts[workItemId] : undefined;
  if (!layout) return undefined;
  if (layout.root.kind === 'pane') return layout.root.tabs;
  const cached = openTabsByLayout.get(layout);
  if (cached) return cached;
  const tabs = listPanes(layout.root).flatMap((pane) => pane.tabs);
  openTabsByLayout.set(layout, tabs);
  return tabs;
}

const CenterLayoutKeyContext = createContext<(workItemId: string) => string>((id) => id);

/**
 * Maps a work item id to the layout key of the view around it, for shared rows
 * (artifact chips) that only know the item. The owner's layout is keyed by the
 * id itself, the default; the participant view provides its own namespace.
 */
export const CenterLayoutKeyProvider = CenterLayoutKeyContext.Provider;

export function useOpenCenterTabs(workItemId: string | undefined): StripTab[] | undefined {
  const toLayoutKey = useContext(CenterLayoutKeyContext);
  const layoutKey = workItemId === undefined ? undefined : toLayoutKey(workItemId);
  return useCenterTabsStore((store) => selectOpenCenterTabs(store, layoutKey));
}

/**
 * The focused pane's strip, with the flat-strip API. Opening and activating
 * route through the layout (the Room lives in one pane, a session in at most
 * one); session reconciliation and pruning apply to every pane.
 */
export function useCenterTabs(workItemId: string) {
  const layout = useLayout(workItemId);
  const applyLayout = useCenterTabsStore((store) => store.applyLayout);

  return useMemo(() => {
    const pane = getFocusedPane(layout);
    const apply = (update: (l: CenterLayoutState) => CenterLayoutState) =>
      applyLayout(workItemId, update);
    const applyFocused = (update: (s: CenterTabsState) => CenterTabsState) =>
      apply((l) => updateFocusedPane(l, update));
    return {
      tabs: pane.tabs,
      active: pane.active,
      open: (tab: CenterTab, options?: OpenTabOptions) =>
        apply((l) => openTabInLayout(l, tab, { preview: options?.preview ?? false })),
      activate: (tab: CenterTab) => apply((l) => activateTabInLayout(l, tab)),
      promote: (tab: DocumentTab) => applyFocused((s) => promoteTab(s, tab)),
      close: (tab: StripTab) => apply((l) => closeTabInLayout(l, tab, l.focusedPaneId)),
      closeOthers: (tab: DocumentTab) => applyFocused((s) => closeOtherTabs(s, tab)),
      closeToRight: (tab: DocumentTab) => applyFocused((s) => closeTabsToRight(s, tab)),
      closeToLeft: (tab: DocumentTab) => applyFocused((s) => closeTabsToLeft(s, tab)),
      closeAll: () => applyFocused(closeAllTabs),
      moveTab: (from: string, toIndex: number) => applyFocused((s) => moveTab(s, from, toIndex)),
      prune: (isStale: (tab: DocumentTab) => boolean) =>
        apply((l) => updateEveryPane(l, (s) => pruneTabs(s, isStale))),
      /** See `normalizePathTabs`: joins artifact and file tabs for the same path, in every pane. */
      normalizePaths: (artifacts: readonly PathTabArtifact[], primaryWorktreeId?: string) =>
        apply((l) => updateEveryPane(l, (s) => normalizePathTabs(s, artifacts, primaryWorktreeId))),
      /** Drops session tabs whose id isn't in `liveSessionIds` anymore, in every pane. */
      reconcileSessions: (liveSessionIds: ReadonlySet<string>) =>
        apply((l) => reconcileSessionsInLayout(l, liveSessionIds)),
      /** See `defaultActiveForSessions`: opens the lone chat session once, idempotently. */
      applySessionDefault: (chatSessionIds: readonly string[]) =>
        apply((l) => applySessionDefaultInLayout(l, chatSessionIds)),
      /** See `syncSessionTabsInLayout`: the strip's session policy over the item's session rows. */
      syncSessions: (sessions: readonly SessionTabSource[]) =>
        apply((l) => syncSessionTabsInLayout(l, sessions)),
    };
  }, [layout, applyLayout, workItemId]);
}

export type CenterTabsController = ReturnType<typeof useCenterTabs>;

/**
 * One pane's strip with the flat-strip API, for that pane's tab strip and the
 * shortcuts. Opening and activating focus the pane; a session or the Room still
 * opens wherever the layout pins it.
 */
export function usePaneTabs(workItemId: string, paneId: string) {
  const layout = useLayout(workItemId);
  const applyLayout = useCenterTabsStore((store) => store.applyLayout);

  return useMemo(() => {
    const pane = findPane(layout, paneId) ?? getFocusedPane(layout);
    const apply = (update: (l: CenterLayoutState) => CenterLayoutState) =>
      applyLayout(workItemId, update);
    const applyPane = (update: (s: CenterTabsState) => CenterTabsState) =>
      apply((l) => updatePane(focusPane(l, pane.id), pane.id, update));
    return {
      tabs: pane.tabs,
      active: pane.active,
      open: (tab: CenterTab, options?: OpenTabOptions) =>
        apply((l) =>
          openTabInLayout(focusPane(l, pane.id), tab, { preview: options?.preview ?? false })
        ),
      activate: (tab: CenterTab) => applyPane((s) => activateTab(s, tab)),
      promote: (tab: DocumentTab) => applyPane((s) => promoteTab(s, tab)),
      close: (tab: StripTab) => apply((l) => closeTabInLayout(l, tab, pane.id)),
      closeOthers: (tab: DocumentTab) => applyPane((s) => closeOtherTabs(s, tab)),
      closeToRight: (tab: DocumentTab) => applyPane((s) => closeTabsToRight(s, tab)),
      closeToLeft: (tab: DocumentTab) => applyPane((s) => closeTabsToLeft(s, tab)),
      closeAll: () => applyPane(closeAllTabs),
    };
  }, [layout, applyLayout, workItemId, paneId]);
}

export type PaneTabsController = ReturnType<typeof usePaneTabs>;

/** The whole split tree and the pane-level operations, for the pane UI. */
export function useCenterLayout(workItemId: string) {
  const layout = useLayout(workItemId);
  const applyLayout = useCenterTabsStore((store) => store.applyLayout);

  return useMemo(() => {
    const apply = (update: (l: CenterLayoutState) => CenterLayoutState) =>
      applyLayout(workItemId, update);
    return {
      layout,
      focusPane: (paneId: string) => apply((l) => focusPane(l, paneId)),
      // The width guard lives here, not in `splitPane`: the layout model is
      // pure and knows nothing about rendered widths. A split that cannot give
      // both halves PANE_MIN_WIDTH is refused rather than allowed to produce
      // two unusable panes.
      splitPane: (paneId: string, direction: SplitDirection, tab?: StripTab, side?: SplitSide) => {
        if (!canSplitPaneWidth(measurePaneWidth(paneId), direction)) return;
        apply((l) => splitPane(l, paneId, direction, tab, side));
      },
      // "Open to the side" only splits when the centre is a single pane. When
      // that pane is too narrow to split, the tab still opens — in place. The
      // request was to open the tab; the side is where, not whether.
      openToSide: (tab: StripTab, options?: OpenTabOptions) => {
        const preview = options?.preview ?? false;
        const root = layout.root;
        if (root.kind === 'pane' && !canSplitPaneWidth(measurePaneWidth(root.id), 'horizontal')) {
          apply((l) => openTabInLayout(l, tab, { preview }));
          return;
        }
        apply((l) => openToSide(l, tab, { preview }));
      },
      moveTab: (move: MoveTabRequest) => {
        if (move.split && !canSplitPaneWidth(measurePaneWidth(move.toPaneId), move.split)) return;
        apply((l) => moveTabInLayout(l, move));
      },
      closeTab: (paneId: string, tab: StripTab) => apply((l) => closeTabInLayout(l, tab, paneId)),
      resizeSplit: (splitId: string, sizes: [number, number]) =>
        apply((l) => resizeSplit(l, splitId, sizes)),
      /** Any flat tab transition (`center-tabs-model.ts`) on one pane. */
      updatePane: (paneId: string, update: (s: CenterTabsState) => CenterTabsState) =>
        apply((l) => updatePane(l, paneId, update)),
    };
  }, [layout, applyLayout, workItemId]);
}

export type CenterLayoutController = ReturnType<typeof useCenterLayout>;
