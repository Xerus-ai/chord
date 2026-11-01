import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { RepoIcon } from '@shared/repo-icons';
import type { WorkItemStatusBucket } from '@shared/work-item-status';
import { getStatusWord, statusSignalForBucket, statusTextClass } from '@renderer/lib/status-dot';
import { cn } from '@renderer/utils/utils';
import { RepoGroupMenu, type RepoGroupActions } from './repo-group-menu';
import { RepoIdentityTile } from './repo-identity-tile';
import { capitalizeStatusWord } from './row-presentation';

/**
 * A plain section label ("Projects", "Workspaces"): 12px
 * semibold on a passive foreground. The weight is what separates it from the
 * row metadata below; at normal weight the two read as the same line.
 */
export function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex h-7 items-center gap-1.5 px-2 pt-1 text-list-meta font-semibold uppercase tracking-list-label text-text-passive">
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </div>
  );
}

/**
 * The band header's icon per bucket. Its title is not declared here: the
 * user decided there is ONE status vocabulary, `status-dot.ts`'s — a row
 * says "Waiting for you", so its band must say it too, via
 * `statusGroupTitle` below rather than a second, disagreeing table.
 */
const STATUS_GROUP: Record<WorkItemStatusBucket, { icon: LucideIcon }> = {
  needs_input: { icon: CircleAlert },
  failed: { icon: CircleX },
  working: { icon: CircleDot },
  ready_to_review: { icon: CircleCheck },
  idle: { icon: CircleDashed },
  done: { icon: CircleCheck },
};

/** The band header's title, from the same word and the same sentence-case
 * transform a row's status word goes through — the one vocabulary. */
function statusGroupTitle(bucket: WorkItemStatusBucket): string {
  return capitalizeStatusWord(getStatusWord(bucket));
}

/** The leading 16px visual of a group row: a status icon or a repo's identity tile. */
function GroupVisual({ kind, groupKey, label, icon }: GroupHeaderIdentity) {
  if (kind === 'status') {
    const bucket = groupKey as WorkItemStatusBucket;
    const Icon = STATUS_GROUP[bucket].icon;
    const tone =
      bucket === 'done' ? 'text-text-muted' : statusTextClass(statusSignalForBucket(bucket));
    return <Icon className={cn('size-icon-sm', tone)} strokeWidth={1.75} />;
  }
  return <RepoIdentityTile repoId={groupKey} label={label} icon={icon} />;
}

interface GroupHeaderIdentity {
  kind: 'repo' | 'status';
  /** Repo id or status bucket. */
  groupKey: string;
  label: string;
  /** The repo's chosen icon; null renders the coloured letter tile. */
  icon?: RepoIcon | null;
}

/** A project row: 28px, 13px semibold. */
function GroupRowShell({
  onClick,
  onContextMenu,
  children,
}: {
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      data-sidebar-group-header
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="group flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-surface-hover"
    >
      {children}
    </div>
  );
}

/** A collapsible section — Done is the one that ships collapsed. */
export function CollapsibleSection({
  label,
  count,
  defaultCollapsed = false,
  onOpenChange,
  children,
}: {
  label: string;
  count: number;
  defaultCollapsed?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={cn('mt-1', !collapsed && 'pb-3')}>
      <GroupRowShell
        onClick={() => {
          setCollapsed(!collapsed);
          onOpenChange?.(collapsed);
        }}
      >
        <span className="flex size-icon-md shrink-0 items-center justify-center">
          <CircleCheck className="size-icon-sm text-text-muted" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-list-row font-semibold leading-none text-text-muted">
          {label}
        </span>
        <span className="text-tiny tracking-tiny tabular-nums text-text-passive">{count}</span>
      </GroupRowShell>
      {!collapsed && children}
    </div>
  );
}

/**
 * A group header — a repo (identity tile) or a status bucket (status icon).
 *
 * The trailing slot is the prototype's `.gh`: the item count normally, swapped
 * for the actions on hover or while the menu is open, with the chevron always
 * last so the collapse affordance never moves. `···` and `+` are repo-only,
 * and only for a repo with a row in the local `repos` table — a teammate's
 * repo name and the `'no-repo'` group have neither an icon to set nor an id
 * the create-work-item dialog could select.
 */
export function GroupHeader({
  kind,
  groupKey,
  label,
  tooltip = null,
  icon,
  itemCount,
  isCollapsed,
  onToggle,
  onNewWorkItem,
  repoActions,
  currentIcon = null,
}: GroupHeaderIdentity & {
  itemCount: number;
  /** Why the label carries a hint (sidebar-projection.ts), shown on hover. */
  tooltip?: string | null;
  isCollapsed: boolean;
  onToggle: () => void;
  onNewWorkItem?: () => void;
  /** Present only for a repo group backed by a local `repos` row. */
  repoActions?: RepoGroupActions;
  currentIcon?: RepoIcon | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = kind === 'status' ? statusGroupTitle(groupKey as WorkItemStatusBucket) : label;
  // The count yields its slot to the actions, so nothing shifts on hover. With
  // no actions to swap in — a status band — it simply stays.
  const hasActions = Boolean(repoActions || onNewWorkItem);

  return (
    <GroupRowShell
      onClick={onToggle}
      onContextMenu={
        repoActions
          ? (event) => {
              event.preventDefault();
              setMenuOpen(true);
            }
          : undefined
      }
    >
      <span
        className={cn(
          'flex size-icon-md shrink-0 items-center justify-center',
          isCollapsed && 'opacity-60'
        )}
      >
        <GroupVisual kind={kind} groupKey={groupKey} label={label} icon={icon} />
      </span>
      {/* A project is the loudest label in the list: full foreground at
          semibold, against muted rows. At muted/normal weight the groups
          disappeared into the items under them. */}
      <span
        title={tooltip ?? undefined}
        className="min-w-0 flex-1 truncate text-list-row font-semibold leading-none text-text"
      >
        {title}
      </span>

      <span
        className={cn(
          'shrink-0 text-tiny tracking-tiny tabular-nums text-text-passive',
          hasActions && 'group-hover:hidden',
          hasActions && menuOpen && 'hidden'
        )}
      >
        {itemCount}
      </span>

      {/* Removed from layout, not just made transparent: an invisible
          `opacity-0` slot still took ~48px, parking the count mid-row on repos
          with actions while teammate repos had it beside the chevron. */}
      {hasActions && (
        <span className={cn('hidden shrink-0 items-center group-hover:flex', menuOpen && 'flex')}>
          {repoActions && (
            <RepoGroupMenu
              repoId={groupKey}
              label={label}
              currentIcon={currentIcon}
              actions={repoActions}
              open={menuOpen}
              onOpenChange={setMenuOpen}
            />
          )}
          {onNewWorkItem && (
            <button
              aria-label={`New work item in ${label}`}
              title={`New work item in ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                onNewWorkItem();
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-inset hover:text-text"
            >
              <Plus className="size-icon-sm" strokeWidth={2.25} />
            </button>
          )}
        </span>
      )}

      <ChevronDown
        className={cn(
          '-mr-1 size-icon-sm shrink-0 text-text-passive transition-transform',
          isCollapsed && '-rotate-90'
        )}
        strokeWidth={1.75}
      />
    </GroupRowShell>
  );
}
