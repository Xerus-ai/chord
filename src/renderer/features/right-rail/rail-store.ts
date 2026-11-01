import { create } from 'zustand';
import { rpc } from '@renderer/lib/ipc';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';

/** The five mutually-exclusive panels the rail's tab strip switches between. */
export type RailPanelId = 'work-item' | 'explorer' | 'source-control' | 'checks-pr' | 'run';

export const RAIL_PANEL_IDS: readonly RailPanelId[] = [
  'work-item',
  'explorer',
  'source-control',
  'checks-pr',
  'run',
];

/**
 * The band carries the PR chip, the state line, the roster and the one action
 * button, and — on Windows/Linux — clears the OS window controls (~138px).
 * At 360px that leaves the state line ~40px, which is why the band swaps it to
 * its short form (`BandState.short`) when narrow rather than truncating it.
 * The default opens at that floor: the rail is drag-resizable, so the cheaper
 * default is the narrow one a user widens, not the wide one they must shrink.
 */
export const RAIL_MIN_WIDTH = 360;
export const RAIL_MAX_WIDTH = 720;
const RAIL_DEFAULT_WIDTH = RAIL_MIN_WIDTH;

export interface RailSnapshot {
  open: boolean;
  width: number;
  panel: RailPanelId;
  /** Section id -> collapsed. Absent means the section's own default applies. */
  collapsed: Record<string, boolean>;
}

interface RailStore extends RailSnapshot {
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setWidth: (width: number) => void;
  /**
   * Tabs picked by hand so far (tab strip, a panel's link, a shortcut). The
   * default-tab rule leaves a work item alone once this moves. Not persisted.
   */
  handPicks: number;
  /** A panel's shortcut: opens the rail on it, or hides the rail when it is already showing. */
  activate: (panel: RailPanelId) => void;
  /** A tab picked by hand: switches to it without touching open/closed. */
  pickPanel: (panel: RailPanelId) => void;
  /** Switches tab without touching open/closed, for the default-tab rule. */
  selectPanel: (panel: RailPanelId) => void;
  toggleSection: (sectionId: string, defaultOpen: boolean) => void;
}

function isRailPanelId(value: unknown): value is RailPanelId {
  return typeof value === 'string' && RAIL_PANEL_IDS.some((id) => id === value);
}

function clampWidth(width: number): number {
  return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(width)));
}

export const useRailStore = create<RailStore>((set) => ({
  open: true,
  width: RAIL_DEFAULT_WIDTH,
  panel: 'work-item',
  collapsed: {},
  handPicks: 0,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setWidth: (width) => set({ width: clampWidth(width) }),
  activate: (panel) =>
    set((state) => ({
      handPicks: state.handPicks + 1,
      ...(state.open && state.panel === panel ? { open: false } : { open: true, panel }),
    })),
  pickPanel: (panel) => set((state) => ({ panel, handPicks: state.handPicks + 1 })),
  selectPanel: (panel) => set({ panel }),
  toggleSection: (sectionId, defaultOpen) =>
    set((state) => ({
      collapsed: {
        ...state.collapsed,
        [sectionId]: !(state.collapsed[sectionId] ?? !defaultOpen),
      },
    })),
}));

export function getRailSnapshot(state: RailSnapshot): RailSnapshot {
  return { open: state.open, width: state.width, panel: state.panel, collapsed: state.collapsed };
}

const VIEW_STATE_KEY = 'right-rail';

snapshotRegistry.register(VIEW_STATE_KEY, useRailStore, getRailSnapshot);

let hydration: Promise<void> | null = null;

/**
 * Restores open/width/active panel/collapsed sections from `viewState`.
 *
 * Every field is validated rather than cast: the stored blob is whatever an
 * older build wrote, and a bad `panel` there would leave the rail rendering no
 * panel at all. Anything unreadable keeps the store's default.
 */
export function hydrateRailState(): Promise<void> {
  if (hydration) return hydration;
  hydration = rpc.viewState.get(VIEW_STATE_KEY).then((stored) => {
    if (!stored || typeof stored !== 'object') return;
    const snapshot = stored as Partial<RailSnapshot>;
    const next: Partial<RailSnapshot> = {};
    if (typeof snapshot.open === 'boolean') next.open = snapshot.open;
    if (typeof snapshot.width === 'number' && Number.isFinite(snapshot.width)) {
      next.width = clampWidth(snapshot.width);
    }
    if (isRailPanelId(snapshot.panel)) next.panel = snapshot.panel;
    if (snapshot.collapsed && typeof snapshot.collapsed === 'object') {
      next.collapsed = Object.fromEntries(
        Object.entries(snapshot.collapsed).filter(([, value]) => typeof value === 'boolean')
      ) as Record<string, boolean>;
    }
    useRailStore.setState(next);
  });
  return hydration;
}

/** Whether a section is expanded, honouring its own default until the user decides. */
export function useSectionOpen(sectionId: string, defaultOpen: boolean): boolean {
  return useRailStore((state) => !(state.collapsed[sectionId] ?? !defaultOpen));
}
