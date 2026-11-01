import { subscribeWithSelector } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { NavigationSnapshot } from '@shared/view-state';
import { views, type ViewId, type WrapParams } from '@renderer/app/view-registry';
import { artifactPathTab } from '@renderer/features/work-list/center-tab';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { log } from '@renderer/utils/logger';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

/**
 * Skills and MCP were standalone views before they became settings tabs. A
 * snapshot written by an older build still names them, and restoring a view id
 * the registry no longer knows crashes the workspace on boot — so translate
 * those two onto the tab that replaced them.
 */
const RETIRED_VIEW_TABS: Record<string, 'skills' | 'mcp'> = {
  skills: 'skills',
  mcp: 'mcp',
};

interface SplitViewSnapshotParams {
  workItemId?: string;
  artifactId?: string;
  artifactName?: string;
}

/**
 * The snapshot is persisted state from a possibly older build, not a value this
 * process produced, so its view id is validated rather than trusted. An id that
 * is neither live nor retired means a corrupt snapshot; boot proceeds on the
 * current view instead of rendering an undefined one.
 */
function resolveRestoredView(
  snapshotViewId: string,
  fallbackViewId: ViewId,
  paramsStore: ViewParamsStore
): { currentViewId: ViewId; viewParamsStore: ViewParamsStore } {
  if (snapshotViewId in views) {
    return { currentViewId: snapshotViewId as ViewId, viewParamsStore: paramsStore };
  }

  // The full-screen artifact view became a tab on its work item: restore the
  // same document there instead of dropping the user on an unrelated view.
  if (snapshotViewId === 'split-view') {
    const retired = (paramsStore as Record<string, SplitViewSnapshotParams | undefined>)[
      'split-view'
    ];
    if (retired?.workItemId) {
      if (retired.artifactId) {
        openCenterTab(
          retired.workItemId,
          artifactPathTab(retired.artifactId, retired.artifactName ?? 'Untitled Document')
        );
      }
      return {
        currentViewId: 'work-list',
        viewParamsStore: { ...paramsStore, 'work-list': { workItemId: retired.workItemId } },
      };
    }
  }

  const retiredTab = RETIRED_VIEW_TABS[snapshotViewId];
  if (retiredTab) {
    return {
      currentViewId: 'settings',
      viewParamsStore: { ...paramsStore, settings: { tab: retiredTab } },
    };
  }

  log.warn(`[navigation-store] Ignoring unknown view id in snapshot: ${snapshotViewId}`);
  return { currentViewId: fallbackViewId, viewParamsStore: paramsStore };
}

interface NavigationState {
  currentViewId: ViewId;
  viewParamsStore: ViewParamsStore;
  sync: (viewId: ViewId, paramsStore: ViewParamsStore) => void;
  restoreSnapshot: (snapshot: Partial<NavigationSnapshot>) => void;
}

export const navigationStore = createStore<NavigationState>()(
  subscribeWithSelector((set) => ({
    currentViewId: 'dashboard' as ViewId,
    viewParamsStore: {} as ViewParamsStore,
    sync: (viewId, paramsStore) => set({ currentViewId: viewId, viewParamsStore: paramsStore }),
    restoreSnapshot: (snapshot) =>
      set((state) => {
        const paramsStore = (snapshot.viewParams as ViewParamsStore) ?? state.viewParamsStore;
        if (snapshot.currentViewId === undefined) {
          return { currentViewId: state.currentViewId, viewParamsStore: paramsStore };
        }
        return resolveRestoredView(snapshot.currentViewId, state.currentViewId, paramsStore);
      }),
  }))
);

export function getNavigationSnapshot(state?: NavigationState): NavigationSnapshot {
  const { currentViewId, viewParamsStore } = state ?? navigationStore.getState();
  return {
    currentViewId,
    viewParams: { ...viewParamsStore } as Record<string, unknown>,
  };
}
