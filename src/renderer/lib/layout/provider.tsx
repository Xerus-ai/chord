import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  views,
  type ViewDefinition,
  type ViewId,
  type WrapParams,
} from '@renderer/app/view-registry';
import { useModalContext } from '@renderer/lib/modal/modal-provider';
import { navigationStore } from '@renderer/lib/stores/navigation-store';
import { recordSettingsOrigin, settingsOriginStore } from '@renderer/lib/stores/settings-return';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { clearTelemetryTaskScope } from '@renderer/utils/telemetry-scope';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import {
  WorkspaceNavigateContext,
  WorkspaceSlotsContext,
  WorkspaceUpdateViewParamsContext,
  WorkspaceViewParamsStoreContext,
  WorkspaceWrapParamsContext,
  type NavigateFnTyped,
  type SlotsContextValue,
  type UpdateViewParamsFn,
  type WrapParamsContextValue,
} from './navigation-provider';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

function syncTelemetryScope(_currentViewId: ViewId, _viewParamsStore: ViewParamsStore): void {
  clearTelemetryTaskScope();
}

const viewEvents: Record<
  ViewId,
  | 'home_viewed'
  | 'dashboard_viewed'
  | 'work_list_viewed'
  | 'settings_viewed'
  | 'artifact_link_viewed'
  | 'public_link_viewed'
> = {
  home: 'home_viewed',
  dashboard: 'dashboard_viewed',
  'work-list': 'work_list_viewed',
  settings: 'settings_viewed',
  'artifact-link': 'artifact_link_viewed',
  'public-link': 'public_link_viewed',
};

export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const { closeModal } = useModalContext();
  const [currentViewId, setCurrentViewId] = useState<ViewId>(
    () => navigationStore.getState().currentViewId
  );
  const [viewParamsStore, setViewParamsStore] = useState<ViewParamsStore>(
    () => navigationStore.getState().viewParamsStore
  );
  const [_, startTransition] = useTransition();

  useEffect(() => {
    navigationStore.getState().sync(currentViewId, viewParamsStore);
  }, [currentViewId, viewParamsStore]);

  useEffect(() => {
    const initialViewId = navigationStore.getState().currentViewId;
    focusTracker.initialize({ view: initialViewId });
    syncTelemetryScope(initialViewId, navigationStore.getState().viewParamsStore);
    captureTelemetry(viewEvents[initialViewId], { from_view: null });
  }, []);

  useEffect(() => {
    syncTelemetryScope(currentViewId, viewParamsStore);
  }, [currentViewId, viewParamsStore]);

  const navigate = useCallback(
    (...args: unknown[]) => {
      const [viewId, params] = args as [ViewId, Record<string, unknown> | undefined];
      if (viewId !== currentViewId) {
        const transition = focusTracker.transition(
          {
            view: viewId,
            mainPanel: null,
            rightPanel: null,
            focusedRegion: null,
          },
          'navigation'
        );

        captureTelemetry(viewEvents[viewId], {
          from_view: transition?.previous.view ?? null,
        });
      }

      // Back to app needs the view settings was opened from, with the params
      // it had at that moment — read from the store, which `sync` keeps current.
      const origin = settingsOriginStore.getState();
      origin.setOrigin(
        recordSettingsOrigin(
          origin.origin,
          currentViewId,
          (navigationStore.getState().viewParamsStore[currentViewId] ?? {}) as Record<
            string,
            unknown
          >
        )
      );

      startTransition(() => {
        setCurrentViewId(viewId);
        // Only overwrite stored params when the caller explicitly passes them;
        // navigating without params preserves whatever was stored for that view.
        if (params !== undefined) {
          setViewParamsStore((prev) => ({ ...prev, [viewId]: params }));
        }
        closeModal();
      });
    },
    [closeModal, currentViewId]
  ) as NavigateFnTyped;

  const updateViewParams = useCallback(
    <TId extends ViewId>(
      viewId: TId,
      update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
    ) => {
      setViewParamsStore((prev) => {
        const current = (prev[viewId] ?? {}) as WrapParams<TId>;
        const next = typeof update === 'function' ? update(current) : { ...current, ...update };
        return { ...prev, [viewId]: next };
      });
    },
    []
  ) as UpdateViewParamsFn;

  const slotsValue = useMemo((): SlotsContextValue => {
    const def = (views as unknown as Record<string, ViewDefinition<Record<string, unknown>>>)[
      currentViewId
    ];
    return {
      WrapView: (def.WrapView ?? Fragment) as ComponentType<
        { children: ReactNode } & Record<string, unknown>
      >,
      TitlebarSlot: def.TitlebarSlot ?? (() => null),
      MainPanel: def.MainPanel,
      RightPanel: def.RightPanel ?? null,
      currentView: currentViewId,
    };
  }, [currentViewId]);

  const wrapParamsValue = useMemo(
    (): WrapParamsContextValue => ({
      wrapParams: (viewParamsStore[currentViewId] ?? {}) as Record<string, unknown>,
    }),
    [viewParamsStore, currentViewId]
  );

  const viewParamsStoreValue = useMemo(() => ({ viewParamsStore }), [viewParamsStore]);

  return (
    <WorkspaceNavigateContext.Provider value={navigate}>
      <WorkspaceSlotsContext.Provider value={slotsValue}>
        <WorkspaceWrapParamsContext.Provider value={wrapParamsValue}>
          <WorkspaceViewParamsStoreContext.Provider value={viewParamsStoreValue}>
            <WorkspaceUpdateViewParamsContext.Provider value={updateViewParams}>
              {children}
            </WorkspaceUpdateViewParamsContext.Provider>
          </WorkspaceViewParamsStoreContext.Provider>
        </WorkspaceWrapParamsContext.Provider>
      </WorkspaceSlotsContext.Provider>
    </WorkspaceNavigateContext.Provider>
  );
}
