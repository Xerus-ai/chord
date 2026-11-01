import type { RailPanelId } from './rail-store';

export interface RailPanelDescriptor {
  id: RailPanelId;
  label: string;
  shortcut?: string;
}

/**
 * The five panels, in the order they sit under the band. This list is the
 * manifest — a panel that is not here does not exist. Work item comes first
 * because it is the map of what the work item is made of; the other three are
 * ways of inspecting one part of it.
 */
export const RAIL_PANELS: readonly RailPanelDescriptor[] = [
  { id: 'work-item', label: 'Work item' },
  { id: 'source-control', label: 'Changes', shortcut: 'Mod+Shift+G' },
  { id: 'explorer', label: 'Files', shortcut: 'Mod+Shift+E' },
  { id: 'checks-pr', label: 'Checks' },
  { id: 'run', label: 'Run' },
];

/**
 * The tabs a viewer sees: their panels (`capabilities.railPanels`) in the
 * manifest's order. A panel they cannot use is left out, not greyed: a
 * teammate has no checkout, so Files is not theirs to have.
 */
export function railTabs(allowed: readonly RailPanelId[]): RailPanelDescriptor[] {
  return RAIL_PANELS.filter((panel) => allowed.includes(panel.id));
}

/**
 * The panel to show. The choice is stored once for the app, so it can name a
 * panel this viewer lacks (Files, chosen in an owner view); that falls to
 * Work item, which every viewer has.
 */
export function resolveRailPanel(
  stored: RailPanelId,
  allowed: readonly RailPanelId[]
): RailPanelId {
  return allowed.includes(stored) ? stored : 'work-item';
}
