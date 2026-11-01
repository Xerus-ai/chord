import { ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';
import { useRailStore, useSectionOpen } from './rail-store';

/**
 * Presentation primitives shared by all five rail panels:
 *
 * - Borders: pane chrome is a single bottom border and no shadow; a group
 *   of rows is one border around the group with top-border dividers inside.
 * - Rows: a content column plus a trailing slot. A chevron means
 *   navigation, a kebab means actions on the row, and a control in the
 *   trailing slot stops propagation so the row press does not also fire.
 * - Type: the scanned-list tier (`--text-list-*` in `styles/tokens.css`)
 *   — 13px rows over an 11px meta line, weights 400 and 500. Medium is the
 *   structural-label tier only: section headers and tight action labels, never
 *   row titles. The rail shares that tier with the left sidebar because they
 *   are the same kind of surface, scanned rather than read; a second set of
 *   sizes here is how the two drifted apart before.
 *
 * The section label below matches the global `.section-header` class, which
 * now carries this same spec (index.css). It stays inline rather than using
 * the class because this header also composes truncation and flex layout.
 */

/** Pane chrome: an optional action toolbar with one bottom border, then scrolling content. */
export function PanelShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      aria-label={title}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-canvas"
    >
      {/* The rail header's tab already names the panel, so only a panel with
          actions gets a toolbar row of its own. */}
      {actions && (
        <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-border px-2">
          {actions}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * The rail's one disclosure: header, chevron, count, click anywhere to toggle.
 * Collapsed state persists per section id through the rail's view state, so a
 * user who closes Worktrees finds it closed next launch.
 */
export function RailSection({
  sectionId,
  title,
  count,
  defaultOpen = true,
  trailing,
  children,
}: {
  sectionId: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const open = useSectionOpen(sectionId, defaultOpen);
  const toggleSection = useRailStore((state) => state.toggleSection);

  return (
    <section className="flex shrink-0 flex-col">
      {/* The toggle is the header, and `trailing` sits beside it rather than
          inside it: a button nested in a button is invalid, and the section's
          own action must not also collapse the section. */}
      <div className="group flex w-full items-center pr-3 transition-[background] duration-[80ms] ease-out hover:bg-surface-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggleSection(sectionId, defaultOpen)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent px-3 py-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-icon-xs shrink-0 text-text-passive" />
          ) : (
            <ChevronRight className="size-icon-xs shrink-0 text-text-passive" />
          )}
          <span className="min-w-0 flex-1 truncate text-list-meta font-semibold uppercase tracking-list-label text-text-passive">
            {title}
          </span>
          {count !== undefined && (
            <span className="shrink-0 text-list-meta tabular-nums text-text-passive">{count}</span>
          )}
        </button>
        {trailing}
      </div>
      {open && <div className="flex flex-col pb-2">{children}</div>}
    </section>
  );
}

/**
 * The row itself now lives in `lib/components/list-row.tsx` as `ListRow`, with
 * `RowActions` beside it: the notification dropdown and the command palette
 * are the same kind of surface and needed it too. Import from there — this
 * file deliberately does not re-export it.
 */

/** Kebab trigger geometry, so every row-actions menu in the rail matches. */
export function KebabGlyph() {
  return <MoreVertical className="size-icon-sm" />;
}

export const RAIL_KEBAB_CLASS =
  'flex cursor-pointer items-center justify-center rounded-xs border-none bg-transparent p-0.5 text-text-passive opacity-0 transition-[opacity,background,color] hover:bg-surface-inset hover:text-text-muted group-hover:opacity-100 data-[popup-open]:opacity-100';

/** Empty state: a short noun phrase, centred and muted. No CTA art. */
export function RailEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 py-6 text-center text-tiny tracking-tiny text-text-passive">{children}</p>
  );
}

/** Inline error: one sentence in the status-danger token, in place. */
export function RailError({ message }: { message: string }) {
  return (
    <p role="alert" title={message} className="px-3 py-2 text-tiny tracking-tiny text-status-err">
      {message}
    </p>
  );
}

/** A small filled circle carrying a status token — the only dot shape in the rail. */
export function StatusDot({ className, label }: { className: string; label?: string }) {
  return (
    <span
      aria-label={label}
      title={label}
      className={cn('inline-block size-[6px] shrink-0 rounded-full', className)}
    />
  );
}

/** A section header's own action — attach something to this part of the map. */
export function HeaderAction({
  label,
  title,
  onClick,
}: {
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      className="shrink-0 cursor-pointer rounded-xs border-none bg-transparent px-1 py-0.5 text-list-meta font-medium text-text-passive opacity-0 transition-[opacity,color] hover:text-text-muted group-hover:opacity-100"
    >
      {label}
    </button>
  );
}
