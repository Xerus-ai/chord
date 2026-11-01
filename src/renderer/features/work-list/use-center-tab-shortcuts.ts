import { useTabShortcuts, type TabNavigationProvider } from '@renderer/lib/hooks/useTabShortcuts';
import { nextTab, previousTab, tabAtIndex } from './center-tab-strip-order';
import type { PaneTabsController } from './center-tabs-store';

/**
 * Adapts a centre pane's tab controller into the `TabNavigationProvider`
 * shape `useTabShortcuts` expects, so the work-item centre panel gets
 * next/prev/close/Mod+1-9 tab shortcuts. Ordering lives in
 * `center-tab-strip-order.ts`; this hook just wires it to the controller.
 * Mounted by `WorkItemView` for the focused pane.
 */
export function useCenterTabShortcuts(
  tabs: Pick<PaneTabsController, 'tabs' | 'active' | 'activate' | 'close'>,
  options?: { focused?: boolean }
): void {
  const provider: TabNavigationProvider = {
    setNextTabActive: () => {
      const target = nextTab(tabs.tabs, tabs.active);
      if (target) tabs.activate(target);
    },
    setPreviousTabActive: () => {
      const target = previousTab(tabs.tabs, tabs.active);
      if (target) tabs.activate(target);
    },
    setTabActiveIndex: (index: number) => {
      const target = tabAtIndex(tabs.tabs, index);
      if (target) tabs.activate(target);
    },
    closeActiveTab: () => {
      if (tabs.active) tabs.close(tabs.active);
    },
  };

  useTabShortcuts(provider, options);
}
