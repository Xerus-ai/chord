import { X } from 'lucide-react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import { useTabStripOverflow } from './use-tab-strip-overflow';

/**
 * The topbar's tab rail: boxed cells that scroll
 * horizontally once they outgrow the bar, with ‹ › only while they overflow.
 * Trailing controls (the `+`) go in `trailing` so they never scroll away.
 */
export function TabStrip({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  const { ref, overflow } = useTabStripOverflow();

  return (
    // Shrinks 4× faster than its siblings: tabs scroll, the breadcrumb title can't.
    <div className="flex min-w-0 flex-[0_4_auto] items-center self-stretch">
      <div
        ref={ref}
        role="tablist"
        className="tab-strip-scroll flex min-w-0 items-center gap-1 self-stretch overflow-x-auto overflow-y-hidden px-1"
        style={buildOverflowFade(overflow.canScrollStart, overflow.canScrollEnd)}
      >
        {children}
      </div>
      {trailing}
    </div>
  );
}

/**
 * The rail-end treatment: a scrollable
 * rail ends in a fade, not a scroll arrow. The fade appears only at an end
 * that can still scroll, so it doubles as the affordance — and it costs no
 * horizontal space, which is what the arrows were taking from the tabs.
 * Wheel-to-horizontal scroll is already wired in `useTabStripOverflow`.
 */
function buildOverflowFade(atStart: boolean, atEnd: boolean): CSSProperties | undefined {
  if (!atStart && !atEnd) return undefined;
  const fade = 'var(--tab-overflow-fade)';
  const stops = [
    atStart ? 'transparent 0' : 'black 0',
    `black ${fade}`,
    `black calc(100% - ${fade})`,
    atEnd ? 'transparent 100%' : 'black 100%',
  ].join(', ');
  const mask = `linear-gradient(to right, ${stops})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

/**
 * One centre tab: a 26px rounded pill, icon + 14px
 * label, muted until active, the active one filled with the interaction
 * highlight. No boxes, dividers or underline.
 *
 * Tabs size to their label between the min and max width tokens; `pinned`
 * tabs never shrink. The close button and the status dot share one fixed
 * slot, so hovering never shifts width.
 */
export function ChromeTab({
  icon,
  label,
  active,
  onClick,
  onDoubleClick,
  onClose,
  closeLabel,
  title,
  ariaLabel,
  showStatusDot,
  statusDotTone = 'live',
  width = 'document',
  preview,
  missingLabel,
  tag,
  contextMenu,
}: {
  icon: ReactNode;
  label: ReactNode;
  /**
   * Said after the label and never cut: when the tab is narrow the label
   * truncates, not this (a session's lane, devstation-w366).
   */
  tag?: string | null;
  active: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onClose?: () => void;
  closeLabel?: string;
  title?: string;
  /** The tab's name when `label` shows only part of it (a distinguished session label). */
  ariaLabel?: string;
  /** Live/running marker (owner terminal sessions). */
  showStatusDot?: boolean;
  /** `attention` = waiting on the user (amber); defaults to the live green. */
  statusDotTone?: 'live' | 'attention';
  width?: 'pinned' | 'document';
  /** A preview tab: italic until promoted. */
  preview?: boolean;
  /** The target is gone from disk/cloud — struck through with this tag. */
  missingLabel?: string;
  /** Context menu items; the tab's right-click opens them. */
  contextMenu?: ReactNode;
}) {
  const handleAuxClick = (e: MouseEvent) => {
    if (e.button !== 1 || !onClose) return;
    e.preventDefault();
    onClose();
  };

  const tab = (
    <div
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      tabIndex={0}
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={(e) => {
        // Middle-button down would start autoscroll inside the strip.
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={handleAuxClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      // Joined, not cn(): tailwind-merge reads `text-body` (a type token) as a
      // colour and drops it next to `text-text`.
      className={[
        'group/tab relative flex h-[26px] select-none items-center gap-1.5 rounded-md px-2 text-body tracking-body outline-none transition-colors duration-100 focus-visible:bg-surface-hover',
        // Tabs shrink proportionally
        // from the max toward the minimum and stop there; past that the rail
        // scrolls. Flexbox gives that for free — basis at the max, a hard
        // min-width floor, shrink enabled. Never keyed to viewport width: in a
        // split it is the pane, not the window, that has the space.
        width === 'document' ? 'max-w-[var(--tab-max-width)] min-w-0 shrink' : 'shrink-0',
        onClick ? 'cursor-pointer' : 'cursor-default',
        active
          ? 'bg-surface-active font-semibold text-text'
          : 'text-text-muted hover:bg-surface-hover',
      ].join(' ')}
    >
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className={cn('min-w-0 truncate', preview && 'italic', missingLabel && 'line-through')}>
        {label}
      </span>
      {tag && (
        <span data-tab-tag className="-ml-0.5 shrink-0 whitespace-nowrap">
          · {tag}
        </span>
      )}
      {missingLabel && (
        <span className="shrink-0 text-micro tracking-micro font-medium uppercase text-text-passive">
          {missingLabel}
        </span>
      )}
      {(onClose || showStatusDot) && (
        <span
          className={cn(
            'relative h-4 w-4 shrink-0 items-center justify-center',
            showStatusDot ? 'flex' : 'hidden group-hover/tab:flex'
          )}
        >
          {showStatusDot && (
            <span
              className={cn(
                'absolute h-[6px] w-[6px] rounded-full',
                statusDotTone === 'attention' ? 'bg-status-warn' : 'bg-status-ok',
                onClose && 'group-hover/tab:hidden'
              )}
            />
          )}
          {onClose && (
            <button
              type="button"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className={cn(
                'hidden h-4 w-4 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-text-muted hover:bg-surface-hover-solid hover:text-text group-hover/tab:flex'
              )}
            >
              <X className="size-icon-xs" />
            </button>
          )}
        </span>
      )}
    </div>
  );

  if (!contextMenu) return tab;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={tab} />
      <ContextMenuContent className="min-w-48">{contextMenu}</ContextMenuContent>
    </ContextMenu>
  );
}
