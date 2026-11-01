import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

/**
 * The app's one scanned-list row. Lifted out of the right rail's
 * `rail-primitives.tsx` once a second and third surface needed it — the
 * notification dropdown and the command palette were each about to grow their
 * own copy, which is how the sidebar and the rail drifted apart the first time.
 * It lives in `lib/components/` because it belongs to no single feature.
 *
 * The type is the scanned-list tier (`--text-list-*`, styles/tokens.css): a
 * 13px row title over an 11px meta line. That tier sits below the 12px floor
 * of the app ramp on purpose and is granted only to rows that are scanned
 * rather than read — see the allowlist in `eslint.config.ts`, which enforces
 * it. The row is a content column plus a trailing slot, a
 * chevron means navigation, and a control in the trailing slot stops
 * propagation so the row press does not also fire.
 */
export function ListRow({
  leading,
  title,
  meta,
  trailing,
  selected = false,
  navigates = false,
  metaInline = false,
  metaWrap = false,
  tooltip,
  onOpen,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  navigates?: boolean;
  /** The dense list: meta sits after the title on one 32px line. */
  metaInline?: boolean;
  /**
   * Let the meta block wrap instead of truncating to one line, and top-align
   * the row's leading slot to match. For rows whose meta is a short prose
   * body rather than a stat line — a notification is the case this exists
   * for. Off by default: a dense list wants every row the same height.
   */
  metaWrap?: boolean;
  /** Native tooltip text, when the visible title can truncate. */
  tooltip?: string;
  onOpen?: () => void;
}) {
  const content = (
    <>
      {leading && (
        <span className={cn('flex shrink-0', metaWrap ? 'mt-1 items-start' : 'items-center')}>
          {leading}
        </span>
      )}
      {metaWrap ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-list-row text-text">{title}</span>
          {meta && <span className="text-list-meta text-text-passive">{meta}</span>}
        </span>
      ) : metaInline ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
          <span className="shrink-0 truncate text-list-row text-text">{title}</span>
          {meta && (
            <span className="min-w-0 truncate text-list-meta text-text-passive">{meta}</span>
          )}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-list-row text-text">{title}</span>
          {meta && <span className="truncate text-list-meta text-text-passive">{meta}</span>}
        </span>
      )}
      {trailing}
      {navigates && <ChevronRight className="size-icon-sm shrink-0 text-text-passive" />}
    </>
  );

  // The same card the sidebar's selected row wears (`.list-card`): a brighter
  // border and a translucent wash, never an opaque fill. `mx-1 px-2` keeps the
  // content 12px from the rail edge — where full-bleed `px-3` had it — so the
  // border can exist without the rows shifting.
  const interactive = Boolean(onOpen) || selected;
  const className = cn(
    'group flex min-h-8 gap-2 rounded-lg px-2 py-1.5 text-left transition-[background-color,border-color,box-shadow] duration-200',
    metaWrap ? 'items-start' : 'items-center',
    interactive ? 'list-card mx-1' : 'mx-1 border border-transparent bg-transparent',
    onOpen && 'cursor-pointer'
  );

  if (!onOpen) {
    return (
      <div className={className} data-active={selected} title={tooltip}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-active={selected}
      title={tooltip}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}

/**
 * Trailing-slot wrapper for a control inside a pressable row. Stops the press
 * from reaching the row, which is the whole reason the slot exists.
 */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex shrink-0 items-center gap-0.5"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}
