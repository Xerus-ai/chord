import { useHotkey } from '@tanstack/react-hotkeys';
import { Activity, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useWorkItemSource } from '@renderer/features/work-list/work-item-source';
import type { StatusSignal } from '@renderer/lib/status-dot';
import { ActivityBar } from './activity-bar';
import { RailScopeProvider, type RailScope } from './rail-context';
import { resolveRailPanel } from './rail-panels';
import {
  hydrateRailState,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  useRailStore,
  type RailPanelId,
} from './rail-store';

/**
 * The right rail, one for every viewer (step 4, S7): a status band, the tabs
 * the viewer's capabilities allow, and their panels. The containers
 * (`LocalWorkItemRail`, `CloudWorkItemRail`) supply the scope and the body;
 * open state, width and the active panel are one app-wide store, so the rail
 * keeps its shape whichever side of a shared work item you are on.
 */
export function WorkItemRail({ scope, children }: { scope: RailScope; children: ReactNode }) {
  const open = useRailStore((state) => state.open);
  const width = useRailStore((state) => state.width);
  const setWidth = useRailStore((state) => state.setWidth);
  const toggleOpen = useRailStore((state) => state.toggleOpen);
  const activate = useRailStore((state) => state.activate);
  const allowed = useWorkItemSource().capabilities.railPanels;

  useEffect(() => {
    void hydrateRailState();
  }, []);

  // Here, not in `RailPanels`: a panel's shortcut opens a closed rail.
  useHotkey('Mod+L', () => toggleOpen());
  useHotkey('Mod+Shift+E', () => activate('explorer'), { enabled: allowed.includes('explorer') });
  useHotkey('Mod+Shift+G', () => activate('source-control'), {
    enabled: allowed.includes('source-control'),
  });

  // Closed means gone: the topbar's panel toggle brings it back.
  if (!open) return null;

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface-canvas"
      style={{ width }}
    >
      <RailResizeHandle width={width} onResize={setWidth} />
      <RailScopeProvider value={scope}>{children}</RailScopeProvider>
    </div>
  );
}

/**
 * The tabs and every panel the viewer has, mounted, not rendered —
 * `<Activity mode="hidden">` keeps each panel's scroll position, expanded
 * sections and query subscriptions alive across switches, which is the whole
 * reason the rail is worth having over a tab strip that throws its state away.
 * A stored panel the viewer lacks falls to Work item (`resolveRailPanel`).
 */
export function RailPanels({
  signals,
  counts,
  renderPanel,
}: {
  signals: Partial<Record<RailPanelId, StatusSignal>>;
  counts: Partial<Record<RailPanelId, number>>;
  renderPanel: (panel: RailPanelId) => ReactNode;
}) {
  const { capabilities } = useWorkItemSource();
  const allowed = capabilities.railPanels;
  const storedPanel = useRailStore((state) => state.panel);
  // A tab only chooses its panel. `activate` toggles, which is right for a
  // shortcut but not here: a click on the open tab — say while the default-tab
  // rule has yet to move off it — would hide the whole rail.
  const pickPanel = useRailStore((state) => state.pickPanel);
  const panel = resolveRailPanel(storedPanel, allowed);

  return (
    <>
      <ActivityBar
        panels={allowed}
        active={panel}
        onActivate={pickPanel}
        signals={signals}
        counts={counts}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 w-full flex-col overflow-hidden">
          {allowed.map((id) => (
            <Activity key={id} mode={panel === id ? 'visible' : 'hidden'}>
              {renderPanel(id)}
            </Activity>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Drag to resize. The width is the rail's own state, persisted through view
 * state, so it survives a restart — the surrounding split is not asked to
 * remember it.
 */
function RailResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      onResize(drag.startWidth + (drag.startX - event.clientX));
    },
    [onResize]
  );

  const stop = useCallback(
    function stopListening() {
      dragging.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopListening);
    },
    [onPointerMove]
  );

  useEffect(() => stop, [stop]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the right rail"
      aria-valuenow={width}
      aria-valuemin={RAIL_MIN_WIDTH}
      aria-valuemax={RAIL_MAX_WIDTH}
      onPointerDown={(event) => {
        dragging.current = { startX: event.clientX, startWidth: width };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stop);
      }}
      className="absolute inset-y-0 -left-[2px] z-20 w-[5px] cursor-col-resize bg-transparent transition-colors hover:bg-border-strong"
    />
  );
}
