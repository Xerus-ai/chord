import { MoreVertical, Waves } from 'lucide-react';
import { statusTextClass } from '@renderer/lib/status-dot';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import type { StatusWord } from './row-presentation';
import type { ItemCompareCue, SidebarItem } from './sidebar-projection';

/**
 * The atoms both row layouts are built from. They live apart from either
 * layout so that Compact and Detailed can disagree about arrangement while
 * never disagreeing about what a title, a diff or a status word looks like.
 */

/**
 * The title rule: unread is semibold at full
 * foreground, read is normal at 80%. Contrast comes from weight, not from
 * fading every title.
 */
export function RowTitle({ item }: { item: SidebarItem }) {
  return (
    <>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-list-row',
          item.unread ? 'font-semibold text-text' : 'font-normal text-text/80'
        )}
      >
        {item.name}
      </span>
      {item.unread && <span className="size-1.5 shrink-0 rounded-full bg-status-running" />}
    </>
  );
}

/** What a row that stands for artifacts shared alone holds: "1 artifact", "3 artifacts". */
export function ArtifactCount({ count }: { count: number }) {
  return (
    <span className="shrink-0 text-list-meta text-text-passive">
      {count} {count === 1 ? 'artifact' : 'artifacts'}
    </span>
  );
}

/** How many agents are live on a working item. */
export function RunningChip({ liveSessionCount }: { liveSessionCount: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-list-meta text-status-running">
      <Waves className="size-icon-xs" strokeWidth={1.75} />
      {liveSessionCount > 0 && <span className="tabular-nums">{liveSessionCount}</span>}
    </span>
  );
}

export function RowTime({ item }: { item: SidebarItem }) {
  return (
    <span className="shrink-0 text-list-meta tabular-nums text-text-passive">
      <RelativeTime value={item.updatedAt * 1000} compact />
    </span>
  );
}

/**
 * Why a lane has no +/−, where the count would be: Compare base = upstream on
 * a branch that has none, or a checkout git could not read. One wording for
 * the lane sub-row and a single-lane item's own row (devstation-ama).
 */
export function CompareCueText({ cue }: { cue: ItemCompareCue }) {
  if (cue.kind === 'unreadable') {
    return (
      <span className="shrink-0 text-list-meta text-status-err" title={cue.message}>
        unreadable
      </span>
    );
  }
  return (
    <span
      className="shrink-0 text-list-meta text-text-passive"
      title="Settings › Git compares against the upstream, and this branch has none"
    >
      no upstream
    </span>
  );
}

/** The one coloured word on a meta line, or a Needs You reason in its place. */
export function StatusWordText({
  status,
  reason,
}: {
  status: StatusWord | null;
  reason: string | null;
}) {
  if (reason) return <span className="text-status-warn">{reason}</span>;
  if (!status) return null;
  return <span className={statusTextClass(status.signal)}>{status.word}</span>;
}

/** Dot-separated facts, skipping the ones this row has nothing to say about. */
export function MetaFacts({ parts }: { parts: readonly React.ReactNode[] }) {
  const present = parts.filter((part) => part !== null && part !== false && part !== '');
  return (
    <>
      {present.map((part, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <span className="text-text-passive/50">·</span>}
          <span className="min-w-0 truncate">{part}</span>
        </span>
      ))}
    </>
  );
}

/**
 * The kebab and a right-click open the same menu, so the kebab re-fires the
 * row's own context-menu event at the button's position rather than owning a
 * second menu that would have to be kept in step with the first.
 */
function openRowMenu(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation();
  const row = event.currentTarget.closest('[data-sidebar-row]');
  if (!row) return;
  const { bottom, left } = event.currentTarget.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: left,
      clientY: bottom,
    })
  );
}

export function RowActionsButton() {
  return (
    <button
      type="button"
      aria-label="Work item actions"
      onClick={openRowMenu}
      className="-my-1 flex size-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-inset hover:text-text"
    >
      <MoreVertical className="size-icon-sm" />
    </button>
  );
}
