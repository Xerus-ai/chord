import { createStore } from 'zustand/vanilla';

/**
 * Where "Back to app" goes (settings redesign, devstation-9kwt).
 *
 * Settings replaces the sessions sidebar, so leaving it has to land on the
 * view the user came from — with its params — not on a fixed home. The
 * origin is recorded by the navigation provider when settings is entered
 * from another view. Pure functions, no React: tested in the Node project.
 */

export interface SettingsOrigin {
  viewId: string;
  params: Record<string, unknown>;
}

/**
 * The origin to keep after navigating to `viewId`. Entering settings from a
 * real view records that view; a navigation that is already inside settings
 * (a deep link re-targeting a tab) keeps the origin that was there.
 */
export function recordSettingsOrigin(
  current: SettingsOrigin | null,
  viewId: string,
  params: Record<string, unknown>
): SettingsOrigin | null {
  if (viewId === 'settings') return current;
  return { viewId, params };
}

/** The view to return to. A session that booted into settings goes home. */
export function resolveSettingsReturn(origin: SettingsOrigin | null): SettingsOrigin {
  return origin ?? { viewId: 'dashboard', params: {} };
}

/**
 * Session-only holder for the origin. Its own store rather than a field on
 * `navigation-store`: that module imports the view registry, so anything the
 * settings feature imported from it would close an import cycle.
 */
export const settingsOriginStore = createStore<{
  origin: SettingsOrigin | null;
  setOrigin: (origin: SettingsOrigin | null) => void;
}>()((set) => ({
  origin: null,
  setOrigin: (origin) => set({ origin }),
}));
