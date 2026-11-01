import { statusDotClass, type StatusSignal } from '@renderer/lib/status-dot';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { railTabs } from './rail-panels';
import { StatusDot } from './rail-primitives';
import type { RailPanelId } from './rail-store';

export interface ActivityBarProps {
  /** The viewer's panels (`capabilities.railPanels`); `railTabs` orders them. */
  panels: readonly RailPanelId[];
  active: RailPanelId;
  onActivate: (panel: RailPanelId) => void;
  /** Status dot on a tab: Checks (CI and review) and Run (its processes). */
  signals: Partial<Record<RailPanelId, StatusSignal>>;
  /** Trailing count on a tab, e.g. how many files Changes holds. */
  counts?: Partial<Record<RailPanelId, number>>;
}

/**
 * The rail's tab strip: text-only pills with counts.
 *
 * Text only, and no icons: four labels fit where five icon+label pills did
 * not, and the band above now carries the state that the icons were being
 * asked to imply. The strip is no longer the window's drag region either —
 * the band is, being the rail's top row — and it has no hide button, because
 * the toggle lives in the centre topbar whether the rail is open or closed.
 */
export function ActivityBar({
  panels,
  active,
  onActivate,
  signals,
  counts = {},
}: ActivityBarProps) {
  return (
    <TooltipProvider delay={300}>
      <div
        role="tablist"
        data-testid="rail-activity-bar"
        className="tab-strip-scroll flex h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-1.5"
      >
        {railTabs(panels).map((panel) => {
          const signal = signals[panel.id];
          const count = counts[panel.id];
          const isActive = active === panel.id;

          return (
            <Tooltip key={panel.id}>
              <TooltipTrigger
                className="h-[26px]"
                render={
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onActivate(panel.id)}
                    className={cn(
                      'flex h-[26px] shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-list-row transition-colors',
                      isActive
                        ? 'bg-surface-active font-semibold text-text'
                        : 'text-text-muted hover:bg-surface-hover'
                    )}
                  />
                }
              >
                {panel.label}
                {count !== undefined && count > 0 && (
                  <span className="text-list-meta tabular-nums text-text-passive">{count}</span>
                )}
                {signal && signal !== 'neutral' && <StatusDot className={statusDotClass(signal)} />}
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-tiny tracking-tiny">
                {panel.shortcut ? `${panel.label} · ${panel.shortcut}` : panel.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
